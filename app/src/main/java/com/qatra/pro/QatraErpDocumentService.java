package com.qatra.pro;

import android.Manifest;
import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.MultiFormatWriter;
import com.google.zxing.common.BitMatrix;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

import javax.crypto.KeyGenerator;
import javax.crypto.Mac;
import javax.crypto.SecretKey;

/**
 * Secure document verification, Android print-framework and ESC/POS thermal output for Qatra ERP.
 * Verification signatures are installation-local and backed by Android Keystore. The QR payload
 * intentionally excludes phone numbers and addresses.
 */
public final class QatraErpDocumentService {
    public static final int BLUETOOTH_PERMISSION_REQUEST = 7942;
    private static final String HMAC_ALIAS = "qatra_erp_document_hmac_v1";
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String HMAC_ALGORITHM = "HmacSHA256";
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final int MAX_HTML_BYTES = 1_200_000;
    private static final int MAX_THERMAL_JSON_BYTES = 80_000;

    private final Activity activity;
    private final QatraDatabase database;
    private volatile WebView activePrintWebView;

    public QatraErpDocumentService(Activity activity, QatraDatabase database) {
        this.activity = activity;
        this.database = database;
    }

    public JSONObject createVerification(String type, JSONObject source) throws Exception {
        String normalized = normalizeType(type);
        JSONObject payload = publicPayload(normalized, source);
        String payloadText = payload.toString();
        byte[] bytes = payloadText.getBytes(StandardCharsets.UTF_8);
        String encoded = base64Url(bytes);
        String signature = base64Url(hmac(bytes));
        String uri = "qatra://verify?d=" + Uri.encode(encoded) + "&s=" + Uri.encode(signature);
        JSONObject out = ok();
        out.put("type", normalized);
        out.put("payload", payload);
        out.put("verificationUri", uri);
        out.put("qrDataUri", qrDataUri(uri, 440));
        out.put("issuer", installationIssuer());
        out.put("scope", "LOCAL_INSTALLATION");
        return out;
    }

    public JSONObject verify(String verificationUri) throws Exception {
        if (verificationUri == null || verificationUri.trim().isEmpty()) {
            throw new IllegalArgumentException("رمز التحقق مطلوب");
        }
        Uri uri = Uri.parse(verificationUri.trim());
        if (!"qatra".equalsIgnoreCase(uri.getScheme()) || !"verify".equalsIgnoreCase(uri.getHost())) {
            throw new SecurityException("رمز التحقق ليس من Qatra ERP");
        }
        String encoded = uri.getQueryParameter("d");
        String suppliedSignature = uri.getQueryParameter("s");
        if (encoded == null || suppliedSignature == null) {
            throw new SecurityException("رمز التحقق غير مكتمل");
        }
        byte[] payloadBytes = Base64.decode(encoded, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        byte[] expected = hmac(payloadBytes);
        byte[] actual = Base64.decode(suppliedSignature, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        boolean validSignature = MessageDigest.isEqual(expected, actual);
        Arrays.fill(expected, (byte) 0);
        Arrays.fill(actual, (byte) 0);

        JSONObject out = ok();
        out.put("validSignature", validSignature);
        out.put("trustedInstallation", validSignature);
        out.put("issuer", installationIssuer());
        if (!validSignature) {
            out.put("found", false);
            out.put("matchesCurrent", false);
            out.put("message", "توقيع رمز QR غير صحيح أو صادر من تثبيت آخر");
            return out;
        }

        JSONObject payload = new JSONObject(new String(payloadBytes, StandardCharsets.UTF_8));
        String type = normalizeType(payload.optString("type"));
        JSONObject current = findCurrentRecord(type, payload.optString("id"), payload.optString("no"));
        boolean found = current != null;
        boolean matches = false;
        if (found) {
            JSONObject currentPayload = publicPayload(type, current);
            matches = payload.optString("fingerprint").equals(currentPayload.optString("fingerprint"));
        }
        out.put("payload", payload);
        out.put("type", type);
        out.put("found", found);
        out.put("matchesCurrent", matches);
        out.put("currentStatus", found ? current.optString("status", "") : "");
        out.put("message", !found
                ? "التوقيع صحيح لكن المستند غير موجود في البيانات الحالية"
                : matches ? "المستند صحيح ومتطابق مع بيانات SQLite الحالية"
                : "التوقيع صحيح لكن بيانات المستند الحالية مختلفة");
        return out;
    }

    public JSONObject printHtml(String title, String html, String page) throws Exception {
        byte[] bytes = (html == null ? "" : html).getBytes(StandardCharsets.UTF_8);
        if (bytes.length == 0 || bytes.length > MAX_HTML_BYTES) {
            throw new IllegalArgumentException("حجم مستند الطباعة غير صالح");
        }
        final String safeTitle = sanitizeTitle(title);
        final String source = html;
        final String pageCode = page == null ? "A5L" : page.trim().toUpperCase(Locale.ROOT);
        activity.runOnUiThread(() -> {
            WebView printView = new WebView(activity);
            activePrintWebView = printView;
            WebSettings settings = printView.getSettings();
            settings.setJavaScriptEnabled(false);
            settings.setAllowFileAccess(false);
            settings.setAllowContentAccess(false);
            settings.setBlockNetworkLoads(true);
            printView.setWebViewClient(new WebViewClient() {
                private boolean printed;
                @Override public void onPageFinished(WebView view, String url) {
                    if (printed || activity.isFinishing()) return;
                    printed = true;
                    PrintManager manager = (PrintManager) activity.getSystemService(Context.PRINT_SERVICE);
                    PrintAttributes.Builder attributes = new PrintAttributes.Builder()
                            .setColorMode(PrintAttributes.COLOR_MODE_COLOR)
                            .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                            .setResolution(new PrintAttributes.Resolution("qatra", "Qatra ERP", 600, 600));
                    if ("A5P".equals(pageCode)) {
                        attributes.setMediaSize(PrintAttributes.MediaSize.ISO_A5.asPortrait());
                    } else if ("A4L".equals(pageCode)) {
                        attributes.setMediaSize(PrintAttributes.MediaSize.ISO_A4.asLandscape());
                    } else if ("A4P".equals(pageCode)) {
                        attributes.setMediaSize(PrintAttributes.MediaSize.ISO_A4.asPortrait());
                    } else {
                        attributes.setMediaSize(PrintAttributes.MediaSize.ISO_A5.asLandscape());
                    }
                    manager.print(safeTitle, view.createPrintDocumentAdapter(safeTitle), attributes.build());
                }
            });
            printView.loadDataWithBaseURL("about:blank", source, "text/html", "UTF-8", null);
        });
        JSONObject out = ok();
        out.put("message", "تم فتح نافذة الطباعة");
        out.put("page", pageCode);
        return out;
    }

    public JSONObject listPairedPrinters() throws Exception {
        if (!ensureBluetoothPermission()) {
            JSONObject out = new JSONObject();
            out.put("ok", false);
            out.put("permissionRequested", true);
            out.put("error", "وافق على إذن الأجهزة القريبة ثم افتح قائمة الطابعات مرة أخرى");
            return out;
        }
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) throw new SecurityException("الجهاز لا يدعم Bluetooth");
        if (!adapter.isEnabled()) throw new SecurityException("شغّل Bluetooth أولًا");
        JSONArray devices = new JSONArray();
        Set<BluetoothDevice> bonded = adapter.getBondedDevices();
        if (bonded != null) {
            for (BluetoothDevice device : bonded) {
                JSONObject row = new JSONObject();
                row.put("name", device.getName() == null ? "طابعة Bluetooth" : device.getName());
                row.put("address", device.getAddress());
                devices.put(row);
            }
        }
        JSONObject out = ok();
        out.put("devices", devices);
        out.put("message", devices.length() == 0
                ? "لا توجد أجهزة مقترنة. اربط الطابعة من إعدادات Bluetooth أولًا"
                : "تم تحميل الطابعات المقترنة");
        return out;
    }

    public JSONObject printThermal(String address, int widthMm, JSONObject document,
            String verificationUri) throws Exception {
        if (!ensureBluetoothPermission()) throw new SecurityException("إذن Bluetooth مطلوب");
        if (document.toString().getBytes(StandardCharsets.UTF_8).length > MAX_THERMAL_JSON_BYTES) {
            throw new IllegalArgumentException("مستند الطباعة الحرارية كبير جدًا");
        }
        String cleanAddress = address == null ? "" : address.trim().toUpperCase(Locale.ROOT);
        if (!cleanAddress.matches("([0-9A-F]{2}:){5}[0-9A-F]{2}")) {
            throw new IllegalArgumentException("عنوان الطابعة غير صحيح");
        }
        int safeWidth = widthMm >= 70 ? 80 : 58;
        JSONObject copy = new JSONObject(document.toString());
        String qr = verificationUri == null ? "" : verificationUri.trim();
        new Thread(() -> {
            BluetoothSocket socket = null;
            try {
                BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
                if (adapter == null || !adapter.isEnabled()) throw new SecurityException("Bluetooth غير متاح");
                BluetoothDevice device = adapter.getRemoteDevice(cleanAddress);
                socket = device.createRfcommSocketToServiceRecord(SPP_UUID);
                adapter.cancelDiscovery();
                socket.connect();
                Bitmap receipt = renderThermalBitmap(copy, safeWidth, qr);
                OutputStream output = socket.getOutputStream();
                output.write(new byte[]{0x1B, 0x40});
                output.write(new byte[]{0x1B, 0x61, 0x01});
                writeRaster(output, receipt);
                output.write(new byte[]{0x1B, 0x64, 0x04});
                output.write(new byte[]{0x1D, 0x56, 0x42, 0x00});
                output.flush();
                receipt.recycle();
                activity.runOnUiThread(() -> toast("تم إرسال المستند إلى الطابعة الحرارية"));
            } catch (Exception error) {
                activity.runOnUiThread(() -> toast("فشلت الطباعة الحرارية: " + safeMessage(error)));
            } finally {
                if (socket != null) try { socket.close(); } catch (Exception ignored) { }
            }
        }, "qatra-thermal-print").start();
        JSONObject out = ok();
        out.put("message", "جارٍ إرسال المستند إلى الطابعة");
        out.put("widthMm", safeWidth);
        return out;
    }

    private JSONObject publicPayload(String type, JSONObject source) throws Exception {
        JSONObject out = new JSONObject();
        out.put("v", 1);
        out.put("type", type);
        out.put("id", first(source, "id", "no", "receiptNo", "settlementNo"));
        out.put("no", first(source, "no", "receiptNo", "settlementNo", "id"));
        out.put("amount", money(firstNumber(source, "total", "amount", "balance", "expectedBalance")));
        out.put("date", first(source, "invoiceDate", "paymentDate", "settlementDate", "date", "createdAt"));
        out.put("subscriberId", first(source, "subscriberId", "accountNo"));
        out.put("cycleId", first(source, "cycleId", "cycleNo"));
        out.put("issuer", installationIssuer());
        out.put("fingerprint", fingerprint(out));
        return out;
    }

    private JSONObject findCurrentRecord(String type, String id, String no) throws Exception {
        String stateText = database.getState("erp.billing");
        if (stateText == null || stateText.trim().isEmpty()) return null;
        JSONObject state = new JSONObject(stateText);
        String collection = "invoice".equals(type) ? "invoices"
                : "payment".equals(type) ? "payments" : "collectorSettlements";
        JSONArray rows = state.optJSONArray(collection);
        if (rows == null) return null;
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.optJSONObject(i);
            if (row == null) continue;
            String rowId = first(row, "id", "no", "receiptNo", "settlementNo");
            String rowNo = first(row, "no", "receiptNo", "settlementNo", "id");
            if ((!id.isEmpty() && id.equals(rowId)) || (!no.isEmpty() && no.equals(rowNo))) {
                return row;
            }
        }
        return null;
    }

    private String qrDataUri(String value, int size) throws Exception {
        BitMatrix matrix = new MultiFormatWriter().encode(value, BarcodeFormat.QR_CODE, size, size);
        Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        for (int y = 0; y < size; y++) {
            for (int x = 0; x < size; x++) bitmap.setPixel(x, y, matrix.get(x, y) ? Color.BLACK : Color.WHITE);
        }
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, bytes);
        bitmap.recycle();
        return "data:image/png;base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP);
    }

    private Bitmap renderThermalBitmap(JSONObject document, int widthMm, String verificationUri)
            throws Exception {
        int width = widthMm >= 70 ? 576 : 384;
        int margin = widthMm >= 70 ? 24 : 16;
        int lineHeight = widthMm >= 70 ? 36 : 30;
        JSONArray lines = document.optJSONArray("lines");
        int count = lines == null ? 0 : Math.min(lines.length(), 80);
        int qrSpace = verificationUri.isEmpty() ? 0 : (widthMm >= 70 ? 190 : 150);
        int height = 160 + count * lineHeight + qrSpace + 100;
        Bitmap bitmap = Bitmap.createBitmap(width, Math.max(height, 320), Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        canvas.drawColor(Color.WHITE);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setColor(Color.BLACK);
        paint.setTypeface(Typeface.create("sans", Typeface.NORMAL));
        paint.setTextAlign(Paint.Align.CENTER);
        paint.setTextSize(widthMm >= 70 ? 30 : 25);
        int y = 44;
        paint.setTypeface(Typeface.create("sans", Typeface.BOLD));
        canvas.drawText(document.optString("title", "Qatra ERP"), width / 2f, y, paint);
        y += lineHeight;
        paint.setTypeface(Typeface.create("sans", Typeface.NORMAL));
        paint.setTextSize(widthMm >= 70 ? 22 : 19);
        String subtitle = document.optString("subtitle", "");
        if (!subtitle.isEmpty()) { canvas.drawText(subtitle, width / 2f, y, paint); y += lineHeight; }
        paint.setStrokeWidth(2f);
        canvas.drawLine(margin, y, width - margin, y, paint);
        y += lineHeight;
        paint.setTextAlign(Paint.Align.RIGHT);
        for (int i = 0; i < count; i++) {
            JSONObject line = lines.optJSONObject(i);
            if (line == null) continue;
            String label = line.optString("label", "");
            String value = line.optString("value", "");
            boolean emphasis = line.optBoolean("emphasis", false);
            paint.setTypeface(Typeface.create("sans", emphasis ? Typeface.BOLD : Typeface.NORMAL));
            paint.setTextSize(emphasis ? (widthMm >= 70 ? 24 : 21) : (widthMm >= 70 ? 21 : 18));
            String text = label.isEmpty() ? value : label + ": " + value;
            if (paint.measureText(text) > width - margin * 2) {
                int split = Math.max(1, text.length() / 2);
                canvas.drawText(text.substring(0, split), width - margin, y, paint);
                y += lineHeight;
                canvas.drawText(text.substring(split), width - margin, y, paint);
            } else {
                canvas.drawText(text, width - margin, y, paint);
            }
            y += lineHeight;
        }
        canvas.drawLine(margin, y, width - margin, y, paint);
        y += 18;
        if (!verificationUri.isEmpty()) {
            int qrSize = widthMm >= 70 ? 160 : 128;
            Bitmap qr = qrBitmap(verificationUri, qrSize);
            canvas.drawBitmap(qr, (width - qrSize) / 2f, y, null);
            y += qrSize + 20;
            qr.recycle();
            paint.setTextAlign(Paint.Align.CENTER);
            paint.setTypeface(Typeface.create("sans", Typeface.NORMAL));
            paint.setTextSize(widthMm >= 70 ? 17 : 15);
            canvas.drawText("امسح الرمز للتحقق من المستند", width / 2f, y, paint);
            y += 24;
        }
        paint.setTextAlign(Paint.Align.CENTER);
        paint.setTextSize(widthMm >= 70 ? 18 : 16);
        canvas.drawText(document.optString("footer", "QATRA PRO"), width / 2f, y + 20, paint);
        return Bitmap.createBitmap(bitmap, 0, 0, width, Math.min(bitmap.getHeight(), y + 55));
    }

    private Bitmap qrBitmap(String value, int size) throws Exception {
        BitMatrix matrix = new MultiFormatWriter().encode(value, BarcodeFormat.QR_CODE, size, size);
        Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        for (int y = 0; y < size; y++) for (int x = 0; x < size; x++) {
            bitmap.setPixel(x, y, matrix.get(x, y) ? Color.BLACK : Color.WHITE);
        }
        return bitmap;
    }

    private static void writeRaster(OutputStream output, Bitmap bitmap) throws Exception {
        int width = bitmap.getWidth();
        int height = bitmap.getHeight();
        int widthBytes = (width + 7) / 8;
        output.write(new byte[]{0x1D, 0x76, 0x30, 0x00,
                (byte) (widthBytes & 0xFF), (byte) ((widthBytes >> 8) & 0xFF),
                (byte) (height & 0xFF), (byte) ((height >> 8) & 0xFF)});
        byte[] row = new byte[widthBytes];
        for (int y = 0; y < height; y++) {
            Arrays.fill(row, (byte) 0);
            for (int x = 0; x < width; x++) {
                int pixel = bitmap.getPixel(x, y);
                int gray = (Color.red(pixel) + Color.green(pixel) + Color.blue(pixel)) / 3;
                if (gray < 160) row[x / 8] |= (byte) (0x80 >> (x % 8));
            }
            output.write(row);
        }
    }

    private boolean ensureBluetoothPermission() {
        if (Build.VERSION.SDK_INT < 31) return true;
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.BLUETOOTH_CONNECT)
                == PackageManager.PERMISSION_GRANTED) return true;
        ActivityCompat.requestPermissions(activity,
                new String[]{Manifest.permission.BLUETOOTH_CONNECT}, BLUETOOTH_PERMISSION_REQUEST);
        return false;
    }

    private SecretKey hmacKey() throws Exception {
        KeyStore store = KeyStore.getInstance(KEYSTORE);
        store.load(null);
        KeyStore.Entry entry = store.getEntry(HMAC_ALIAS, null);
        if (entry instanceof KeyStore.SecretKeyEntry) {
            return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(HMAC_ALGORITHM, KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(HMAC_ALIAS, KeyProperties.PURPOSE_SIGN
                | KeyProperties.PURPOSE_VERIFY)
                .setDigests(KeyProperties.DIGEST_SHA256)
                .build());
        return generator.generateKey();
    }

    private byte[] hmac(byte[] bytes) throws Exception {
        Mac mac = Mac.getInstance(HMAC_ALGORITHM);
        mac.init(hmacKey());
        return mac.doFinal(bytes);
    }

    private String installationIssuer() throws Exception {
        byte[] signature = hmac("QATRA_ERP_ISSUER_V1".getBytes(StandardCharsets.UTF_8));
        String value = toHex(signature).substring(0, 16).toUpperCase(Locale.ROOT);
        Arrays.fill(signature, (byte) 0);
        return value;
    }

    private static String fingerprint(JSONObject payload) throws Exception {
        String source = payload.optString("type") + "|" + payload.optString("id") + "|"
                + payload.optString("no") + "|" + payload.optString("amount") + "|"
                + payload.optString("date") + "|" + payload.optString("subscriberId") + "|"
                + payload.optString("cycleId");
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        return toHex(digest.digest(source.getBytes(StandardCharsets.UTF_8)));
    }

    private static String normalizeType(String type) {
        String value = type == null ? "" : type.trim().toLowerCase(Locale.ROOT);
        if (!"invoice".equals(value) && !"payment".equals(value) && !"settlement".equals(value)) {
            throw new IllegalArgumentException("نوع المستند غير مدعوم");
        }
        return value;
    }

    private static String first(JSONObject source, String... keys) {
        for (String key : keys) {
            Object value = source.opt(key);
            if (value == null || value == JSONObject.NULL) continue;
            String text = String.valueOf(value).trim();
            if (!text.isEmpty()) return text;
        }
        return "";
    }

    private static double firstNumber(JSONObject source, String... keys) {
        for (String key : keys) {
            if (!source.has(key)) continue;
            double value = source.optDouble(key, Double.NaN);
            if (!Double.isNaN(value) && !Double.isInfinite(value)) return value;
        }
        return 0d;
    }

    private static String money(double value) {
        return BigDecimal.valueOf(value).stripTrailingZeros().toPlainString();
    }

    private static String base64Url(byte[] bytes) {
        return Base64.encodeToString(bytes, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
    }

    private static String toHex(byte[] bytes) {
        StringBuilder out = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) out.append(String.format(Locale.ROOT, "%02x", value & 0xff));
        return out.toString();
    }

    private static JSONObject ok() throws Exception {
        JSONObject out = new JSONObject();
        out.put("ok", true);
        return out;
    }

    private static String sanitizeTitle(String title) {
        String value = title == null ? "Qatra ERP" : title.replaceAll("[\\r\\n\\t]+", " ").trim();
        return value.isEmpty() ? "Qatra ERP" : value.substring(0, Math.min(value.length(), 90));
    }

    private void toast(String message) {
        android.widget.Toast.makeText(activity, message, android.widget.Toast.LENGTH_LONG).show();
    }

    private static String safeMessage(Exception error) {
        String message = error.getMessage();
        return message == null || message.trim().isEmpty() ? "خطأ غير متوقع" : message.trim();
    }
}