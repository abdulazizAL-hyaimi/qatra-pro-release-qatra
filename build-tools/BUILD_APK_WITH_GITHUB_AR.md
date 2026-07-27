# البناء عبر GitHub Actions دون Android SDK محلي

تتضمن الحزمة مسارين جاهزين:

- `.github/workflows/build-debug-apks.yml`: ينتج أربع نسخ اختبار غير نهائية.
- `.github/workflows/build-signed-release.yml`: ينتج أربع نسخ نهائية موقّعة ويتحقق من التوقيع قبل إتاحتها.

## أولًا: بناء نسخ الاختبار

1. أنشئ مستودعًا **خاصًا** في GitHub.
2. فك ضغط الحزمة، ثم ارفع **محتويات مجلد** `qatra-pro-secure-v2` إلى جذر المستودع. يجب أن يظهر `build.gradle` و`app` و`.github` في جذر المستودع.
3. افتح تبويب **Actions**.
4. اختر **Qatra Pro - Build Debug APKs**.
5. اضغط **Run workflow** ثم انتظر اكتمال المهمة.
6. افتح نتيجة المهمة ونزّل Artifact الذي يبدأ اسمه بـ `qatra-pro-debug-apks-`.

يحتوي Artifact على:

- `qatra-pro-admin-...-debug.apk`
- `qatra-pro-reader-...-debug.apk`
- `qatra-pro-collector-...-debug.apk`
- `qatra-pro-cashier-...-debug.apk`
- `SHA256SUMS.txt`

نسخ Debug للاختبار فقط ولا تُستخدم كإصدار تشغيلي نهائي.

## ثانيًا: إعداد الإصدار الموقّع

أنشئ مفتاح توقيع جديدًا واحتفظ بالملف الأصلي ونسخة احتياطية منه في مكانين آمنين. لا تستخدم المفتاح القديم ولا ترفعه إلى ملفات المستودع.

حوّل ملف المفتاح الجديد إلى Base64 على جهاز موثوق، ثم أضف القيم التالية من:

`Settings → Secrets and variables → Actions → New repository secret`

| اسم Secret | المحتوى |
| --- | --- |
| `QATRA_RELEASE_KEYSTORE_BASE64` | محتوى ملف المفتاح بصيغة Base64 |
| `QATRA_KEYSTORE_PASSWORD` | كلمة مرور مخزن المفاتيح |
| `QATRA_KEY_ALIAS` | اسم المفتاح داخل المخزن |
| `QATRA_KEY_PASSWORD` | كلمة مرور المفتاح |

بعد إضافة الأسرار:

1. افتح **Actions**.
2. اختر **Qatra Pro - Build Signed Release**.
3. بعد إكمال واختتام خطة القبول الميداني، اكتب `READY_FOR_PRODUCTION` في خانة التأكيد ثم اضغط **Run workflow**.
4. نزّل Artifact الذي يبدأ اسمه بـ `qatra-pro-signed-release-`.
5. احتفظ بملفات `SHA256SUMS.txt` و`SIGNING-CERTIFICATES.txt` و`RELEASE-MANIFEST.txt` مع ملفات APK.

المسار يعيد إنشاء المفتاح داخل مجلد GitHub المؤقت فقط، يتحقق منه، يبني الحزم الأربع، يفحصها بـ `apksigner`، ثم يحذف المفتاح المؤقت. ملف المفتاح لا يُرفع ضمن Artifact.

## تنبيهات

- لا تضع كلمات المرور أو Base64 في ملف YAML أو Gradle أو JavaScript.
- لا ترفع `.jks` أو `.keystore` إلى المستودع، حتى لو كان خاصًا.
- لا تشارك Artifact النهائي قبل تنفيذ خطة الاختبار الموجودة في `TEST_PLAN_AR.md`.
- إذا فُقد مفتاح التوقيع الجديد فلن يمكن تحديث التطبيقات الموقّعة به لاحقًا.
