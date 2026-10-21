# Sır envanteri (yalnızca adlar ve tarihler, DEĞER YOK)

Kural: değerler sohbete, koda, commit'e yazılmaz. Yalnızca GitHub Secrets / Variables ve Vercel Environment Variables. Rotasyon sonrası bu tabloda "son yenileme" güncellenir.

| Ad | Nerede | Amaç | Süre sonu | Son yenileme | Rotasyon |
|---|---|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | GitHub Secret + Vercel | Sunucu tarafı tam DB erişimi | yok | bilinmiyor (K) | 6 ayda bir veya sızıntı şüphesinde |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel | Tarayıcıda yalnızca giriş (public şemada yetkisi yok, migration 025) | yok | — | gerekmez |
| `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL` | GitHub + Vercel | Proje adresi (sır değil) | — | — | — |
| `ADMIN_EMAIL` | Vercel | Yönetici e-postası | — | — | — |
| `GH_TOKEN` | Vercel | Panelden workflow tetikleme (fine-grained, yalnız bu repo, Actions RW) | **K: süreli olmalı, tarihi yaz** | bilinmiyor (K) | süresi dolmadan |
| `TRENDYOL_SELLER_ID` | GitHub Secret | Satıcı no | — | — | — |
| `TRENDYOL_API_KEY`, `TRENDYOL_API_SECRET` | GitHub Secret | Trendyol API | yok | ~14.10.2026 (aracı yükleyici sonrası yenilendi) | 6 ayda bir |
| `TRENDYOL_SHIPMENT_ADDRESS_ID`, `TRENDYOL_RETURN_ADDRESS_ID` | GitHub Secret | Ürün açma adresleri | — | — | — |
| `HB_MERCHANT_ID`, `HB_USERNAME`, `HB_PASSWORD`, `HB_USER_AGENT` | GitHub Secret/Variable | Hepsiburada (şu an SIT test ortamı) | — | 21.10.2026 (SIT) | canlıya geçişte yeni bilgiler |
| `AMAZON_LWA_CLIENT_ID`, `AMAZON_LWA_CLIENT_SECRET`, `AMAZON_REFRESH_TOKEN`, `AMAZON_SELLER_ID` | GitHub Secret | Amazon SP-API (şu an kapalı) | LWA secret: Amazon'un istediği tarihte | bilinmiyor (K) | Amazon bildirimine göre |
| `XML_URL` | GitHub Secret | Eski BayilikXML (kullanılmıyor) | — | — | K: silinebilir |
| Tedarikçi XML adresleri | Supabase `suppliers.xml_url` (panelde maskeli) | Toptancım XML | — | — | tedarikçi değiştirirse |

Notlar
- Sohbette paylaşılmış olanlar: HB SIT test bilgileri (test ortamı), BayilikXML dışa aktarma adresi, Toptancım XML adresleri (tedarikçinin herkese verdiği). Canlı HB bilgileri gelince sohbete yazılmamalı.
- Depo herkese açık (S0.5 kararı bekliyor): Actions günlüklerinde maliyet/müşteri verisi basılmaz, maliyetli CSV artifact yüklenmez (S1.2).
