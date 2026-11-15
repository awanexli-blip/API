# Panel yenileme önerisi (16.11.2026, K onayı bekliyor)

K'nın istediği: modern, telefonda tam uyumlu, analiz ağırlıklı, panelden çok iş yürütülebilen tek panel (https://trentakip.duckdns.org). Kural: `tam-ozellik` becerisi (her bölüm tek seferde eksiksiz).

## 1. Bugünkü durum (ölçüm 15.11)
- 31 bileşen, 24 sekme; sol menü + pazaryeri alt sekmeleri (13 alt sekme). Telefonda çekmece menü (`<dialog>`), alt menü (Panel/Satış/Sipariş/Pazaryeri/Menü).
- Hız: çoğu sayfa < 2 sn; yavaşlar Ürün seçimi 4,5 sn, Satış raporu 4,8, Ürünler 4,1, Gönderim durumu 3,5-4,3 (Rekabet 13,6 -> 1,6 düzeltildi).
- Eksikler: analiz tek bir "Satış raporu" ekranında; günlük iş listesi dağınık (fatura, iade, soru, sipariş, ret ayrı ekranlarda); tedarikçi siparişi ekranı yok; mobilde geniş tablolar kart görünümünde ama filtreler sıkışık.

## 2. Yeni bilgi mimarisi (menü)
1. **Bugün** (yeni ana sayfa): yapılacaklar kuyruğu tek listede, öncelik sırasıyla: tedarikçiye verilecek siparişler, kargo süresi dolanlar, cevap bekleyen sorular, kesilecek/imzalanacak faturalar, iade faturaları, reddedilen ilanlar, zararına satışlar. Her satırda tek dokunuşla işlem.
2. **Siparişler**: liste + sipariş detayı (satırlar, tedarikçi, maliyet, kâr, kargo, fatura, iade, olay geçmişi) + **Tedarikçi siparişi** (taslak / onay / gönder / "başka yerden verdim" / durum).
3. **Analiz**: kâr (sipariş/ürün/tedarikçi/kategori/pazaryeri), satış trendi, iade oranı, komisyon ve kargo gideri, en çok satan / zarar eden, buybox durumu, stok devir. Tarih aralığı, karşılaştırma (önceki dönem), CSV.
4. **Ürünler**: katalog, tedarikçi karşılaştırma (aynı ürün en ucuz, `product_dupes`), açıklamalar, içe aktarma, feed.
5. **Pazaryerleri**: Trendyol / Hepsiburada / Amazon; her biri için özet, ilan durumu, fiyat ve kâr kuralları, rekabet, ret/gönderilemeyen, kategori/marka eşleme.
6. **Faturalar**: satış + iade faturası + kurumsal + mükerrer (bugünkü bölüm).
7. **Tedarikçiler**: liste, XML/API/robot ayarı, bakiye (Bezos /me), sipariş yöntemi, son içe aktarma.
8. **Ayarlar**: kâr tabanı/marj, kargo, kullanıcılar, Telegram, yedek, sistem durumu.

## 3. Analiz göstergeleri (Gösterge paneli / Analiz)
- Bugün / 7 gün / 30 gün: ciro, net kâr, sipariş, ortalama sepet, kâr marjı, iade oranı; önceki döneme göre değişim.
- Kâr şelalesi: satış -> komisyon -> kargo -> sabit gider -> iade payı -> KDV -> maliyet -> net.
- Pazaryeri ve tedarikçi kırılımı; en kârlı / en zararlı 10 ürün; 40/60 TL taban altına düşen satışlar (kampanya etkisi).
- Operasyon: kargoya geç kalan, iptal, tedarikçi gecikmesi; buybox kazanma oranı.
- Stok: stoksuz kalan çok satanlar, yaşam döngüsü (arşiv/silme) sayıları.

## 4. Mobil ve görsel tasarım
- Telefon öncelikli: alt menü 5 öğe (Bugün, Siparişler, Analiz, Ürünler, Menü); kart listeler, yapışkan filtre çubuğu, aşağı çekip yenile, büyük dokunma hedefleri (44 px).
- Tasarım dili: mevcut gece/gündüz temaları korunur; sade kartlar, renk yalnızca durum için (yeşil tamam, sarı bekliyor, kırmızı sorun); grafiklerde erişilebilir palet (dataviz becerisi).
- Modern web (MWG 1.0): `<dialog>` pencereler (yapıldı), popover menüler, container query ile kart düzeni, view transitions ile sayfa geçişi, `content-visibility` uzun listelerde.

## 5. Hız hedefi
- Her sayfa < 1,5 sn (sunucu yükte < 3 sn). Ağır sorgular tek seferlik toplama/önbellek (`buybox_report` deseni), sayfalama, ilk ekranda yalnızca özet.

## 6. Aşamalar (her biri tek seferde, `tam-ozellik`)
1. **Bugün + Tedarikçi siparişi** (en çok zaman kazandıran; Bezos API + robot taslakları burada).
2. **Analiz** (kâr ve satış göstergeleri, grafikler).
3. **Sipariş detayı + Ürün tedarikçi karşılaştırma**.
4. **Menü sadeleştirme + mobil alt menü + görsel tasarım geçişi**.
5. **Hız turu** (yavaş 4 ekran).

## 7. K kararı gerekenler
- Ana sayfa "Bugün" (yapılacaklar) mı, yoksa analiz mi olsun?
- Tedarikçi siparişinde tam otomatik ne zaman açılsın (bekleme süresi, tutar sınırı)?
- Analizde hangi göstergeler en önemli (ilk sürüme girecekler)?
