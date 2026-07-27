FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY server/QatraPro.Api/QatraPro.Api.csproj server/QatraPro.Api/
RUN dotnet restore server/QatraPro.Api/QatraPro.Api.csproj
COPY server/QatraPro.Api/ server/QatraPro.Api/
RUN dotnet publish server/QatraPro.Api/QatraPro.Api.csproj -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app
ENV ASPNETCORE_URLS=http://+:8080
ENV DOTNET_EnableDiagnostics=0
EXPOSE 8080
COPY --from=build /app/publish .
USER app
ENTRYPOINT ["dotnet", "QatraPro.Api.dll"]
