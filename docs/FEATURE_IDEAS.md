# Đề xuất tính năng (tham khảo emulator và công cụ cho RPG Maker)

Tài liệu này điểm lại những tính năng hay có ở các emulator và công cụ chơi / hỗ trợ game RPG Maker hiện nay, rồi chọn ra những tính năng hợp với kiến trúc của dự án (plugin runtime chèn vào bản web + Worker + R2 + Cloudflare Access).

## Công cụ đã tham khảo

| Công cụ | Loại | Tính năng đáng chú ý |
|---|---|---|
| **JoiPlay** (Android) | Trình chạy RPG Maker / Ren'Py | Gamepad ảo, chỉnh phím, menu cheat, tua nhanh (gán vào nút vai), đổi font, tùy chọn hiển thị |
| **EasyRPG Player** | Trình chạy RPG Maker 2000/2003 | Tua nhanh 2 mức (giữ nửa / giữ hết cò RT), menu Settings trong game (Video, Audio, Input, Engine), chế độ scale ảnh |
| **RetroArch / emulator console** | Emulator | Save state / quick save, tua nhanh, rewind, chụp màn hình, shader (CRT, làm mượt pixel), remap tay cầm, profile theo game, tự lưu |
| **MTool** | Công cụ PC cho game RPG Maker / Wolf / Ren'Py | Tăng tốc game, dịch máy trực tiếp lên màn hình, sửa switch / biến khi đang chơi, cheat, lướt thoại |
| **Translator++, MV Translation Helper** | Công cụ dịch | Trích xuất toàn bộ text, dịch qua file riêng, áp bản dịch mà không sửa dữ liệu gốc |
| **Cheat Menu (emerladCoder), Yanfly Cheat Menu, AkerCheats** | Plugin / mod cheat MV/MZ | God mode, hồi đầy, sửa EXP / chỉ số / vàng / vật phẩm, đi xuyên tường, tốc độ di chuyển, sửa switch / biến, lưu / dịch chuyển tới vị trí, lưu ở bất cứ đâu |
| **Enhanced Debug Screen (F9), RMSE / save editor online** | Debug / sửa save | Sửa switch / biến có tìm kiếm, sửa save ngoài game (dự án đã hỗ trợ qua 💾 Saves) |
| **Plugin battle speed / game speed toggle** | Plugin | Tăng tốc trận đánh, bỏ qua animation |
| **Trình đọc visual novel (Ren'Py, KiriKiri…)** | Engine VN | Lịch sử hội thoại (backlog), auto-advance, skip thoại đã đọc |
| **Playnite, LaunchBox, playlist RetroArch** | Launcher | Thư viện game có ảnh bìa, thời gian chơi, lần chơi cuối |

## Bảng tính năng đề xuất

Ưu tiên: **P1** nên làm sớm (giá trị cao, công sức vừa phải), **P2** đáng làm, **P3** để sau.
Công sức: **S** vài giờ, **M** 1–3 ngày, **L** hơn 3 ngày.

| # | Tính năng | Tham khảo từ | Cách tích hợp vào dự án | Ưu tiên | Công sức |
|---|---|---|---|---|---|
| 1 | **Tua nhanh** ×2 / ×3 / ×4 (giữ hoặc bật / tắt) | JoiPlay, EasyRPG, RetroArch, MTool | Plugin mới `RWK_Speed`: cho `SceneManager.updateMain` chạy `updateScene` N lần mỗi frame (âm thanh giữ nguyên tốc độ). Nút ⏩ trên toolbar; giữ nút = tạm tăng tốc, chạm = bật / tắt. Gán được vào nút L/R hoặc cò của tay cầm thật | P1 | S |
| 2 | **Lướt thoại / tự chạy thoại** (skip, auto) | Trình đọc VN, MTool | Patch `Window_Message`: chế độ Skip bỏ hiệu ứng gõ chữ và tự sang trang; Auto chờ theo độ dài câu rồi sang trang. Không tự chọn hộ ở hộp lựa chọn | P1 | S |
| 3 | **Quick save / quick load** (lưu ở bất cứ đâu khi đang ở map) | RetroArch, AkerCheats, JoiPlay | Thêm slot riêng (vd. `quick`) ghi bằng `DataManager.saveGame` kể cả khi game tắt lưu; load từ ⚙ hoặc màn hình tiêu đề. Đi qua `RWK_SaveSync` nên cũng được đồng bộ lên cloud. Chỉ cho lưu ở `Scene_Map`, cảnh báo khi đang chạy event | P1 | M |
| 4 | **Lịch sử bản save trên cloud** (khôi phục bản cũ) | Steam Cloud, auto save state của RetroArch | Trong `worker/saves.js`: mỗi lần PUT, chép bản cũ sang `saves/<user>/<slug>/.history/<name>/<time>`, giữ N bản gần nhất. Thêm API liệt kê / khôi phục và mục "Khôi phục bản cũ" trong 💾 Saves. Chống mất dữ liệu khi save hỏng hoặc chọn nhầm bản lúc có xung đột | P1 | M |
| 5 | **Cài như app (PWA)** + giữ màn hình sáng | Emulator trên mobile | Thêm `manifest.webmanifest` (tên, icon lấy từ `icon/` của game, `display: fullscreen`, hướng màn hình) để "Thêm vào màn hình chính". Dùng Screen Wake Lock API để màn hình không tắt khi đang chơi. Đi cùng Service Worker trong ROADMAP | P1 | S |
| 6 | **Menu cheat** (vàng, vật phẩm, EXP / level, chỉ số, hồi đầy, god mode, thắng / thoát trận ngay) | Cheat Menu emerladCoder, Yanfly, JoiPlay, AkerCheats | Plugin `RWK_Cheats`, mặc định **tắt** (`cheats: true` trong config). Giao diện DOM giống bảng ⚙ để dùng tốt trên điện thoại. Lấy tên vật phẩm / actor từ `$dataItems`, `$dataActors` | P2 | M |
| 7 | **Sửa switch / biến khi đang chơi** (có ô tìm theo tên) | MTool, Enhanced Debug Screen, F9 | Một tab của `RWK_Cheats`: liệt kê `$dataSystem.switches/variables` kèm giá trị hiện tại, tìm theo tên hoặc số, sửa trực tiếp. Tiện để gỡ kẹt khi event lỗi | P2 | S |
| 8 | **Đi xuyên tường, dịch chuyển, nhớ vị trí** | Cheat Menu emerladCoder | Thuộc `RWK_Cheats`: bật `$gamePlayer.setThrough`, lưu / gọi lại (map, x, y), dịch chuyển bằng `reserveTransfer`. Có cảnh báo có thể bỏ qua event | P3 | S |
| 9 | **Tốc độ di chuyển / luôn chạy** | Cheat Menu, plugin QoL phổ biến | Công tắc trong ⚙: luôn dash (đảo nút X), hoặc cộng thêm tốc độ di chuyển. Lưu theo trình duyệt như `itemBatch` | P2 | S |
| 10 | **Tăng tốc trận đánh / bỏ animation** | Plugin battle speed, MTool | Patch `BattleManager` / `Spriteset_Battle`: bỏ chờ animation, tăng tốc log trận. Có thể gộp với #1 (tự tua nhanh trong trận) | P2 | M |
| 11 | **Lịch sử hội thoại (backlog)** | Trình đọc VN | Ghi lại tên nhân vật + nội dung mỗi lần `Window_Message` hiện câu mới (bỏ mã điều khiển `\C[n]`…), xem trong một bảng cuộn. Hữu ích khi lỡ tay lướt qua thoại | P2 | M |
| 12 | **Tay cầm thật: chỉnh phím + gán phím tắt** | JoiPlay, RetroArch, EasyRPG | Bảng chỉnh trong ⚙: bấm nút trên tay cầm Bluetooth / bàn phím để gán vào `ok`, `cancel`, phím plugin, tua nhanh, quick save. Sửa `Input.gamepadMapper` / `Input.keyMapper`, lưu theo trình duyệt | P2 | M |
| 13 | **Chụp màn hình** | RetroArch, JoiPlay | Nút trong ⚙: `Graphics._canvas` (hoặc `renderer.extract` với WebGL) → PNG, tải về hoặc chia sẻ qua Web Share API | P3 | S |
| 14 | **Tùy chọn hiển thị**: giữ tỉ lệ / kéo giãn / scale số nguyên, ảnh nét (pixel) hay mượt, giới hạn 30 FPS để tiết kiệm pin | RetroArch, EasyRPG, JoiPlay | CSS `image-rendering: pixelated` cho canvas, chỉnh cách tính kích thước trong `Graphics._updateCanvas`, bỏ qua 1 frame / 2 khi bật tiết kiệm pin. Có thể hiện FPS | P3 | M |
| 15 | **Rung khi bấm nút ảo** | Emulator Android (Lemuroid…) | `navigator.vibrate(10)` trong `RWK_MobileControls`, công tắc bật / tắt | P3 | S |
| 16 | **Đổi font** (dễ đọc hơn, hỗ trợ chữ Việt / CJK thiếu glyph) | JoiPlay | Config `font` trong CLI: thêm file font vào bản build và ghi đè `$dataSystem.advanced.mainFontFilename` (MZ) / `gamefont.css` (MV) | P3 | S |
| 17 | **Bản dịch dạng patch** (trích text, dịch file riêng, áp lúc build) | Translator++, MV Translation Helper | Lệnh CLI `extract-text` xuất `data/*.json` thành file dịch (CSV / JSON); lần deploy sau áp bản dịch vào bản build tạm, **không** sửa game gốc. Rất hợp với cách "chỉ upload file đã đổi" | P2 | L |
| 18 | **Dịch máy trực tiếp** | MTool | Thử nghiệm: Worker gọi Workers AI (có hạn mức miễn phí) để dịch câu thoại, cache kết quả trong R2 theo hash câu. Cần chú ý hạn mức và chất lượng; nên làm sau #17 | P3 | L |
| 19 | **Thời gian chơi + trang thư viện game** (`/` liệt kê game, ảnh bìa, lần chơi cuối) | Playnite, LaunchBox, playlist RetroArch | Mở rộng mục "personal hub" trong ROADMAP: lấy ảnh bìa từ `img/titles1`, thời gian chơi và lần chơi cuối từ save `global` đã có trên R2 | P3 | M |
| 20 | **Tối ưu dung lượng tải** (PNG → WebP, giảm bitrate OGG, tùy chọn) | Bộ repack game mobile | Tùy chọn CLI `optimize`: nén lại ảnh / nhạc trong bản build tạm, patch loader để đọc định dạng mới. Giảm thời gian tải trên 4G và tránh giới hạn 25 MiB. Cẩn trọng với file đã mã hóa (`.rpgmvp`, `.png_`) | P3 | L |
| 21 | **Bảng báo lỗi dễ đọc + console trên điện thoại** | Công cụ debug mobile (eruda) | Bắt `window.onerror` / lỗi plugin, hiện tên plugin gây lỗi, nút "Thử tiếp tục" và "Sao chép log". Tùy chọn bật console nhỏ để xem lỗi trên điện thoại | P3 | S |

## Không khuyến nghị

| Tính năng | Tham khảo từ | Lý do |
|---|---|---|
| Rewind (tua ngược) | RetroArch | Phải chụp toàn bộ trạng thái JS mỗi vài frame; game RPG Maker giữ trạng thái trong rất nhiều object, plugin và tài nguyên đang tải, nên tốn bộ nhớ và dễ lỗi. Quick save (#3) + lịch sử save (#4) đã giải quyết phần lớn nhu cầu |
| Save state thật (chụp mọi thứ, kể cả giữa trận / giữa cảnh) | RetroArch | Cùng lý do; chỉ an toàn khi lưu bằng cơ chế save của chính game ở `Scene_Map` |
| Chơi mạng (netplay) | RetroArch | Game RPG Maker là game một người; không đáng công sức |
| Thành tựu kiểu RetroAchievements | RetroArch | Không có cơ sở dữ liệu thành tựu chung cho game RPG Maker |
| Giải mã / xuất tài nguyên game | RPG Maker Decrypter | Không cần cho việc chơi (bản web đọc thẳng file mã hóa) và đi ngược mục "dùng có trách nhiệm" |

## Thứ tự gợi ý

1. **#1 Tua nhanh, #2 Lướt thoại, #5 PWA + giữ màn hình sáng**: nhỏ, dùng ngay mỗi ngày trên điện thoại.
2. **#3 Quick save, #4 Lịch sử save**: dựa trên `RWK_SaveSync` / `worker/saves.js` đã có, tăng độ an toàn cho save.
3. **#6–#9 Cheat + sửa switch / biến** gói trong một plugin `RWK_Cheats` tắt mặc định.
4. **#11 Backlog, #12 Chỉnh phím tay cầm, #17 Bản dịch dạng patch**.
5. Phần còn lại khi có thời gian.

Mỗi tính năng runtime nên theo đúng mẫu của `RWK_ItemBatch`: một file `runtime/RWK_*.js`, một khóa bật / tắt trong config, một mục trong menu ⚙ (`RWK.tools.add`), và chạy được cả MZ lẫn MV.
