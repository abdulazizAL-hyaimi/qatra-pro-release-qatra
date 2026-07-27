using System.ComponentModel.DataAnnotations;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

var connectionString = builder.Configuration.GetConnectionString("QatraDb");
if (string.IsNullOrWhiteSpace(connectionString))
    throw new InvalidOperationException("ConnectionStrings:QatraDb is required.");

var jwtKey = builder.Configuration["Jwt:Key"];
if (string.IsNullOrWhiteSpace(jwtKey) || jwtKey.Length < 32)
    throw new InvalidOperationException("Jwt:Key must contain at least 32 characters.");

var jwtIssuer = builder.Configuration["Jwt:Issuer"] ?? "QatraPro";
var jwtAudience = builder.Configuration["Jwt:Audience"] ?? "QatraPro.Clients";

builder.Services.AddDbContext<QatraDbContext>(options =>
    options.UseNpgsql(connectionString, npgsql => npgsql.EnableRetryOnFailure(5)));

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.RequireHttpsMetadata = !builder.Environment.IsDevelopment();
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = jwtIssuer,
            ValidateAudience = true,
            ValidAudience = jwtAudience,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey)),
            ClockSkew = TimeSpan.FromSeconds(30)
        };
    });

builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("AdminOnly", policy => policy.RequireRole("ADMIN"));
    options.AddPolicy("OperationalUser", policy =>
        policy.RequireRole("ADMIN", "READER", "COLLECTOR", "CASHIER"));
});

builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddFixedWindowLimiter("login", limiter =>
    {
        limiter.PermitLimit = 5;
        limiter.Window = TimeSpan.FromMinutes(1);
        limiter.QueueLimit = 0;
        limiter.AutoReplenishment = true;
    });
    options.AddFixedWindowLimiter("sync", limiter =>
    {
        limiter.PermitLimit = 120;
        limiter.Window = TimeSpan.FromMinutes(1);
        limiter.QueueLimit = 20;
        limiter.QueueProcessingOrder = QueueProcessingOrder.OldestFirst;
        limiter.AutoReplenishment = true;
    });
});

builder.Services.AddHealthChecks().AddDbContextCheck<QatraDbContext>();
builder.Services.AddEndpointsApiExplorer();

var allowedOrigins = (builder.Configuration["Cors:AllowedOrigins"] ?? string.Empty)
    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

builder.Services.AddCors(options => options.AddPolicy("QatraClients", policy =>
{
    if (allowedOrigins.Length == 0)
        policy.SetIsOriginAllowed(_ => false);
    else
        policy.WithOrigins(allowedOrigins).AllowAnyHeader().AllowAnyMethod();
}));

var app = builder.Build();

app.UseForwardedHeaders(new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto
});
app.UseRateLimiter();
app.UseCors("QatraClients");
app.UseAuthentication();
app.UseAuthorization();

await InitializeDatabaseAsync(app.Services, builder.Configuration);

app.MapGet("/", () => Results.Ok(new
{
    service = "Qatra Pro API",
    version = "2.0-phase1",
    utc = DateTimeOffset.UtcNow
}));

app.MapHealthChecks("/health");

app.MapPost("/api/v1/auth/login", async (
    LoginRequest request,
    QatraDbContext db,
    CancellationToken cancellationToken) =>
{
    var username = NormalizeUsername(request.Username);
    if (username.Length < 3 || string.IsNullOrWhiteSpace(request.Pin))
        return Results.Unauthorized();

    var user = await db.Users.SingleOrDefaultAsync(
        item => item.Username == username && item.IsActive,
        cancellationToken);

    if (user is null)
        return Results.Unauthorized();

    var hasher = new PasswordHasher<AppUser>();
    var verification = hasher.VerifyHashedPassword(user, user.PinHash, request.Pin);
    if (verification == PasswordVerificationResult.Failed)
    {
        db.AuditEvents.Add(AuditEvent.Create(user.WorkspaceId, user.Id, "LOGIN_FAILED", username));
        await db.SaveChangesAsync(cancellationToken);
        return Results.Unauthorized();
    }

    if (verification == PasswordVerificationResult.SuccessRehashNeeded)
        user.PinHash = hasher.HashPassword(user, request.Pin);

    user.LastLoginAt = DateTimeOffset.UtcNow;
    db.AuditEvents.Add(AuditEvent.Create(
        user.WorkspaceId,
        user.Id,
        "LOGIN_SUCCESS",
        request.DeviceId?.Trim() ?? string.Empty));
    await db.SaveChangesAsync(cancellationToken);

    var accessToken = TokenFactory.Create(user, jwtKey, jwtIssuer, jwtAudience);
    return Results.Ok(new LoginResponse(
        accessToken,
        DateTimeOffset.UtcNow.AddHours(12),
        user.Username,
        user.DisplayName,
        user.Role,
        user.EmployeeCode,
        user.WorkspaceId));
})
.RequireRateLimiting("login");

app.MapPost("/api/v1/devices/register", async (
    DeviceRegistration request,
    ClaimsPrincipal principal,
    QatraDbContext db,
    CancellationToken cancellationToken) =>
{
    var userId = RequiredUserId(principal);
    var workspaceId = RequiredWorkspace(principal);
    var deviceId = request.DeviceId?.Trim() ?? string.Empty;

    if (deviceId.Length is < 8 or > 128)
        return Results.BadRequest(new { error = "DEVICE_ID_INVALID" });

    var device = await db.Devices.SingleOrDefaultAsync(
        item => item.WorkspaceId == workspaceId && item.DeviceId == deviceId,
        cancellationToken);

    if (device is null)
    {
        device = new RegisteredDevice
        {
            Id = Guid.NewGuid(),
            WorkspaceId = workspaceId,
            UserId = userId,
            DeviceId = deviceId,
            Role = principal.FindFirstValue(ClaimTypes.Role) ?? string.Empty,
            DeviceName = request.DeviceName?.Trim() ?? "Android",
            AppVersion = request.AppVersion?.Trim() ?? string.Empty,
            RegisteredAt = DateTimeOffset.UtcNow,
            LastSeenAt = DateTimeOffset.UtcNow,
            IsActive = true
        };
        db.Devices.Add(device);
    }
    else
    {
        if (!device.IsActive || device.UserId != userId)
            return Results.Conflict(new { error = "DEVICE_ALREADY_ASSIGNED" });

        device.LastSeenAt = DateTimeOffset.UtcNow;
        device.DeviceName = request.DeviceName?.Trim() ?? device.DeviceName;
        device.AppVersion = request.AppVersion?.Trim() ?? device.AppVersion;
    }

    db.AuditEvents.Add(AuditEvent.Create(workspaceId, userId, "DEVICE_REGISTERED", deviceId));
    await db.SaveChangesAsync(cancellationToken);
    return Results.Ok(new { device.Id, device.DeviceId, device.Role, device.LastSeenAt });
})
.RequireAuthorization("OperationalUser");

app.MapPost("/api/v1/sync/push", async (
    SyncPushRequest request,
    ClaimsPrincipal principal,
    QatraDbContext db,
    CancellationToken cancellationToken) =>
{
    var userId = RequiredUserId(principal);
    var workspaceId = RequiredWorkspace(principal);
    var operationIdText = request.OperationId?.Trim() ?? string.Empty;
    var deviceId = request.DeviceId?.Trim() ?? string.Empty;
    var entityType = request.EntityType?.Trim().ToUpperInvariant() ?? string.Empty;

    if (!Guid.TryParse(operationIdText, out var operationId))
        return Results.BadRequest(new { error = "OPERATION_ID_MUST_BE_UUID" });
    if (deviceId.Length is < 8 or > 128)
        return Results.BadRequest(new { error = "DEVICE_ID_INVALID" });
    if (entityType.Length is < 2 or > 64)
        return Results.BadRequest(new { error = "ENTITY_TYPE_INVALID" });

    var device = await db.Devices.SingleOrDefaultAsync(
        item => item.WorkspaceId == workspaceId &&
                item.DeviceId == deviceId &&
                item.IsActive,
        cancellationToken);

    if (device is null || device.UserId != userId)
        return Results.Forbid();

    var duplicate = await db.SyncOperations.SingleOrDefaultAsync(
        item => item.WorkspaceId == workspaceId && item.OperationId == operationId,
        cancellationToken);

    if (duplicate is not null)
        return Results.Ok(new SyncPushResponse(duplicate.Sequence, true, duplicate.AcceptedAt));

    var payloadJson = request.Payload.GetRawText();
    if (Encoding.UTF8.GetByteCount(payloadJson) > 1_000_000)
        return Results.BadRequest(new { error = "PAYLOAD_TOO_LARGE" });

    await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

    var operation = new SyncOperation
    {
        WorkspaceId = workspaceId,
        OperationId = operationId,
        DeviceId = deviceId,
        UserId = userId,
        Role = principal.FindFirstValue(ClaimTypes.Role) ?? string.Empty,
        EntityType = entityType,
        EntityId = request.EntityId?.Trim() ?? string.Empty,
        Action = request.Action?.Trim().ToUpperInvariant() ?? "UPSERT",
        PayloadJson = payloadJson,
        ClientCreatedAt = request.ClientCreatedAt,
        AcceptedAt = DateTimeOffset.UtcNow
    };

    db.SyncOperations.Add(operation);
    device.LastSeenAt = DateTimeOffset.UtcNow;
    db.AuditEvents.Add(AuditEvent.Create(
        workspaceId,
        userId,
        "SYNC_PUSH_ACCEPTED",
        operationId.ToString()));

    await db.SaveChangesAsync(cancellationToken);
    await transaction.CommitAsync(cancellationToken);

    return Results.Ok(new SyncPushResponse(operation.Sequence, false, operation.AcceptedAt));
})
.RequireAuthorization("OperationalUser")
.RequireRateLimiting("sync");

app.MapGet("/api/v1/sync/pull", async (
    long afterSequence,
    int? limit,
    ClaimsPrincipal principal,
    QatraDbContext db,
    CancellationToken cancellationToken) =>
{
    var workspaceId = RequiredWorkspace(principal);
    var take = Math.Clamp(limit ?? 200, 1, 500);

    var databaseRows = await db.SyncOperations.AsNoTracking()
        .Where(item => item.WorkspaceId == workspaceId && item.Sequence > afterSequence)
        .OrderBy(item => item.Sequence)
        .Take(take)
        .ToListAsync(cancellationToken);

    var rows = databaseRows.Select(item => new
    {
        item.Sequence,
        item.OperationId,
        item.DeviceId,
        item.UserId,
        item.Role,
        item.EntityType,
        item.EntityId,
        item.Action,
        payload = JsonSerializer.Deserialize<JsonElement>(item.PayloadJson, options: null),
        item.ClientCreatedAt,
        item.AcceptedAt
    }).ToList();

    var nextSequence = rows.Count == 0 ? afterSequence : rows[^1].Sequence;
    return Results.Ok(new { items = rows, nextSequence, hasMore = rows.Count == take });
})
.RequireAuthorization("OperationalUser")
.RequireRateLimiting("sync");

app.MapGet("/api/v1/audit", async (
    int? limit,
    ClaimsPrincipal principal,
    QatraDbContext db,
    CancellationToken cancellationToken) =>
{
    var workspaceId = RequiredWorkspace(principal);
    var take = Math.Clamp(limit ?? 100, 1, 500);

    var events = await db.AuditEvents.AsNoTracking()
        .Where(item => item.WorkspaceId == workspaceId)
        .OrderByDescending(item => item.CreatedAt)
        .Take(take)
        .ToListAsync(cancellationToken);

    return Results.Ok(events);
})
.RequireAuthorization("AdminOnly");

app.Run();

static async Task InitializeDatabaseAsync(IServiceProvider services, IConfiguration configuration)
{
    await using var scope = services.CreateAsyncScope();
    var db = scope.ServiceProvider.GetRequiredService<QatraDbContext>();
    await db.Database.EnsureCreatedAsync();

    if (await db.Users.AnyAsync())
        return;

    var username = NormalizeUsername(configuration["BootstrapAdmin:Username"]);
    var pin = configuration["BootstrapAdmin:Pin"] ?? string.Empty;
    var workspaceId = (configuration["BootstrapAdmin:WorkspaceId"] ?? "rawdah")
        .Trim()
        .ToLowerInvariant();

    if (username.Length < 3 || !pin.All(char.IsDigit) || pin.Length is < 6 or > 12)
        throw new InvalidOperationException(
            "A valid bootstrap admin username and 6-12 digit PIN are required for the first run.");

    var admin = new AppUser
    {
        Id = Guid.NewGuid(),
        WorkspaceId = workspaceId,
        Username = username,
        DisplayName = "مدير النظام",
        Role = "ADMIN",
        EmployeeCode = "AD",
        IsActive = true,
        CreatedAt = DateTimeOffset.UtcNow
    };

    admin.PinHash = new PasswordHasher<AppUser>().HashPassword(admin, pin);
    db.Users.Add(admin);
    db.AuditEvents.Add(AuditEvent.Create(
        workspaceId,
        admin.Id,
        "BOOTSTRAP_ADMIN_CREATED",
        username));
    await db.SaveChangesAsync();
}

static string NormalizeUsername(string? value) =>
    (value ?? string.Empty).Trim().ToLowerInvariant();

static Guid RequiredUserId(ClaimsPrincipal principal) =>
    Guid.Parse(principal.FindFirstValue(ClaimTypes.NameIdentifier)
        ?? throw new InvalidOperationException("Authenticated user id is missing."));

static string RequiredWorkspace(ClaimsPrincipal principal) =>
    principal.FindFirstValue("workspace")
        ?? throw new InvalidOperationException("Authenticated workspace is missing.");

static class TokenFactory
{
    public static string Create(
        AppUser user,
        string key,
        string issuer,
        string audience)
    {
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.Name, user.Username),
            new Claim(ClaimTypes.Role, user.Role),
            new Claim("workspace", user.WorkspaceId),
            new Claim("employee_code", user.EmployeeCode)
        };

        var signingCredentials = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)),
            SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            issuer,
            audience,
            claims,
            notBefore: DateTime.UtcNow,
            expires: DateTime.UtcNow.AddHours(12),
            signingCredentials: signingCredentials);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}

sealed class QatraDbContext(DbContextOptions<QatraDbContext> options) : DbContext(options)
{
    public DbSet<AppUser> Users => Set<AppUser>();
    public DbSet<RegisteredDevice> Devices => Set<RegisteredDevice>();
    public DbSet<SyncOperation> SyncOperations => Set<SyncOperation>();
    public DbSet<AuditEvent> AuditEvents => Set<AuditEvent>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<AppUser>()
            .HasIndex(item => new { item.WorkspaceId, item.Username })
            .IsUnique();
        modelBuilder.Entity<AppUser>()
            .HasIndex(item => new { item.WorkspaceId, item.EmployeeCode })
            .IsUnique();
        modelBuilder.Entity<RegisteredDevice>()
            .HasIndex(item => new { item.WorkspaceId, item.DeviceId })
            .IsUnique();
        modelBuilder.Entity<SyncOperation>()
            .HasKey(item => item.Sequence);
        modelBuilder.Entity<SyncOperation>()
            .Property(item => item.Sequence)
            .ValueGeneratedOnAdd();
        modelBuilder.Entity<SyncOperation>()
            .HasIndex(item => new { item.WorkspaceId, item.OperationId })
            .IsUnique();
        modelBuilder.Entity<SyncOperation>()
            .HasIndex(item => new { item.WorkspaceId, item.Sequence });
        modelBuilder.Entity<SyncOperation>()
            .Property(item => item.PayloadJson)
            .HasColumnType("jsonb");
        modelBuilder.Entity<AuditEvent>()
            .HasIndex(item => new { item.WorkspaceId, item.CreatedAt });
    }
}

sealed class AppUser
{
    public Guid Id { get; set; }
    [MaxLength(64)] public string WorkspaceId { get; set; } = "rawdah";
    [MaxLength(32)] public string Username { get; set; } = string.Empty;
    [MaxLength(128)] public string DisplayName { get; set; } = string.Empty;
    [MaxLength(16)] public string Role { get; set; } = string.Empty;
    [MaxLength(2)] public string EmployeeCode { get; set; } = string.Empty;
    public string PinHash { get; set; } = string.Empty;
    public bool IsActive { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? LastLoginAt { get; set; }
}

sealed class RegisteredDevice
{
    public Guid Id { get; set; }
    [MaxLength(64)] public string WorkspaceId { get; set; } = string.Empty;
    public Guid UserId { get; set; }
    [MaxLength(128)] public string DeviceId { get; set; } = string.Empty;
    [MaxLength(16)] public string Role { get; set; } = string.Empty;
    [MaxLength(128)] public string DeviceName { get; set; } = string.Empty;
    [MaxLength(32)] public string AppVersion { get; set; } = string.Empty;
    public bool IsActive { get; set; }
    public DateTimeOffset RegisteredAt { get; set; }
    public DateTimeOffset LastSeenAt { get; set; }
}

sealed class SyncOperation
{
    public long Sequence { get; set; }
    [MaxLength(64)] public string WorkspaceId { get; set; } = string.Empty;
    public Guid OperationId { get; set; }
    [MaxLength(128)] public string DeviceId { get; set; } = string.Empty;
    public Guid UserId { get; set; }
    [MaxLength(16)] public string Role { get; set; } = string.Empty;
    [MaxLength(64)] public string EntityType { get; set; } = string.Empty;
    [MaxLength(128)] public string EntityId { get; set; } = string.Empty;
    [MaxLength(16)] public string Action { get; set; } = "UPSERT";
    public string PayloadJson { get; set; } = "{}";
    public DateTimeOffset? ClientCreatedAt { get; set; }
    public DateTimeOffset AcceptedAt { get; set; }
}

sealed class AuditEvent
{
    public long Id { get; set; }
    [MaxLength(64)] public string WorkspaceId { get; set; } = string.Empty;
    public Guid? UserId { get; set; }
    [MaxLength(64)] public string Action { get; set; } = string.Empty;
    [MaxLength(512)] public string Details { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; }

    public static AuditEvent Create(
        string workspaceId,
        Guid? userId,
        string action,
        string details) => new()
    {
        WorkspaceId = workspaceId,
        UserId = userId,
        Action = action,
        Details = details,
        CreatedAt = DateTimeOffset.UtcNow
    };
}

sealed record LoginRequest(string? Username, string? Pin, string? DeviceId);
sealed record LoginResponse(
    string AccessToken,
    DateTimeOffset ExpiresAt,
    string Username,
    string DisplayName,
    string Role,
    string EmployeeCode,
    string WorkspaceId);
sealed record DeviceRegistration(string? DeviceId, string? DeviceName, string? AppVersion);
sealed record SyncPushRequest(
    string? OperationId,
    string? DeviceId,
    string? EntityType,
    string? EntityId,
    string? Action,
    DateTimeOffset? ClientCreatedAt,
    JsonElement Payload);
sealed record SyncPushResponse(long Sequence, bool Duplicate, DateTimeOffset AcceptedAt);
