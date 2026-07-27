# بناء APK محليًا

المتطلبات: JDK 17 وAndroid SDK 35 وGradle 8.7.

1. افتح المشروع في Android Studio.
2. انتظر اكتمال Gradle Sync.
3. من Build Variants اختر الدور ونوع `debug` أو `release`.
4. للبناء التجريبي للأدوار الأربعة شغّل `build-tools/build-debug-apk.sh`.
5. للبناء النهائي أنشئ مفتاحًا جديدًا خارج المشروع واضبط متغيرات `QATRA_KEYSTORE_*` ثم شغّل `build-tools/build-secure-release.sh`.

لا تضع المفتاح أو كلمات المرور داخل مجلد المشروع.
