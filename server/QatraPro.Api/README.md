# Qatra Pro API

خادم المرحلة الأولى لمنصة قطرة برو متعددة الأجهزة.

## المتطلبات

- .NET 8 SDK أو Docker.
- PostgreSQL 16.
- متغيرات البيئة الموجودة في `.env.production.example`.

## أهم المسارات

- `POST /api/v1/auth/login`
- `POST /api/v1/devices/register`
- `POST /api/v1/sync/push`
- `GET /api/v1/sync/pull?afterSequence=0&limit=200`
- `GET /api/v1/audit`
- `GET /health`

## مثال تسجيل الدخول

```json
{
  "username": "admin.rawdah",
  "pin": "123456",
  "deviceId": "android-device-unique-id"
}
```

## مثال دفع عملية مزامنة

```json
{
  "operationId": "e4d73aa6-d63c-4a90-9be0-128f2b65b2f2",
  "deviceId": "android-device-unique-id",
  "entityType": "PAYMENT",
  "entityId": "PAY-001",
  "action": "UPSERT",
  "clientCreatedAt": "2026-07-16T00:00:00Z",
  "payload": {
    "receiptNo": "AB-20260716-0001",
    "amount": 5000
  }
}
```

إعادة إرسال `operationId` نفسه تعيد نتيجة العملية الأولى ولا تنشئ حركة مكررة.
