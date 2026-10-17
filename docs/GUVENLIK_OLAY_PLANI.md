# Güvenlik Olay Müdahale Planı (Incident Response Plan)

Kapsam: Pazaryeri paneli ve entegrasyonları (Trendyol, Hepsiburada, Amazon SP-API), Supabase veritabanı, Vercel paneli, GitHub depo ve Actions, bu sistemlerdeki pazaryeri bilgileri ("Amazon Information" dahil).
Yürürlük: 17.10.2026 · Sonraki gözden geçirme: 17.04.2027 (her 6 ayda bir)

## 1. Roller

| Rol | Kişi | Görev |
|---|---|---|
| Olay sorumlusu (Incident Owner) | Ewan (hesap sahibi) | Olayı değerlendirir, karar verir, pazaryerlerine ve gerekirse yetkililere bildirir |
| Teknik müdahale | Ewan (gerekirse geliştirici desteğiyle) | Anahtarları iptal eder/yeniler, erişimleri kapatır, kayıtları inceler |

İletişim: ewanalhssan@gmail.com

## 2. Olay nedir?

- API anahtarı, refresh token, `service_role` anahtarı veya şifrenin sızması / sızdığından şüphe
- Panele, GitHub'a, Vercel'e, Supabase'e veya pazaryeri hesabına yetkisiz giriş
- Pazaryeri verilerinin (ilan, fiyat, stok, sipariş) yetkisiz okunması, değiştirilmesi veya silinmesi
- Bilinmeyen fiyat/stok değişiklikleri (ör. eski aracı yükleyicinin hesaba yeniden erişmesi)

## 3. Müdahale adımları

1. **Tespit ve kayıt (0. saat):** Ne, ne zaman, hangi sistem; ekran görüntüsü ve kayıtlar (Supabase `audit_log`, `sync_runs`, GitHub Actions geçmişi, Vercel kayıtları) saklanır.
2. **Sınırlama (ilk 1 saat):**
   - Sızan/şüpheli anahtarlar iptal edilir ve yenilenir: Amazon (Solution Provider Portal → uygulama → LWA bilgileri yenile, yetkiyi kaldır), Trendyol (API secret yenile), Hepsiburada, Supabase (`service_role` anahtarı döndür), GitHub token, Vercel `GH_TOKEN`.
   - Yeni değerler yalnızca GitHub Secrets ve Vercel ortam değişkenlerine girilir.
   - Gerekirse otomatik senkron panelden duraklatılır, şüpheli kullanıcıların panel rolü kaldırılır, hesap şifreleri değiştirilir.
3. **Bildirim (en geç 24 saat):**
   - **Amazon Information** etkilendiyse veya etkilendiğinden şüpheleniliyorsa: tespitten itibaren **24 saat içinde security@amazon.com** adresine e-posta (ne oldu, ne zaman, hangi veriler, alınan önlemler).
   - Diğer pazaryerleri (Trendyol, Hepsiburada) kendi destek kanallarından bilgilendirilir.
   - Kişisel veri etkilendiyse KVKK kapsamındaki yükümlülükler değerlendirilir.
4. **Giderme ve geri dönüş:** Açık kapatılır, yanlış değişen fiyat/stoklar denetim kaydı ve önizleme ile düzeltilir, senkron yeniden açılır.
5. **Değerlendirme (1 hafta içinde):** Nedeni, etkisi ve tekrarını önleyecek önlemler bu dosyanın sonundaki "Olay kayıtları" bölümüne yazılır.

## 4. Önleyici kontroller

- Kimlik bilgileri yalnızca şifreli sunucu tarafı gizli değişkenlerde (GitHub Secrets, Vercel Environment Variables); koda, commit'e, kayıtlara yazılmaz.
- Tüm bağlantılar HTTPS/TLS.
- Panel erişimi giriş + rol bazlı (yönetici / editör / görüntüleyici); veritabanında RLS açık, erişim yalnızca sunucu tarafında.
- Tüm hesaplarda iki adımlı doğrulama (MFA), en az 12 karakterli özel karakterli şifre, yılda bir şifre değişimi.
- Alıcı kişisel verisi (PII) istenmez ve saklanmaz.

## 5. Gözden geçirme

Bu plan her 6 ayda bir (ve her olaydan sonra) gözden geçirilir; tarih aşağıya yazılır.

| Tarih | Gözden geçiren | Not |
|---|---|---|
| 17.10.2026 | Ewan | İlk sürüm |

## Olay kayıtları

(Henüz yok)
