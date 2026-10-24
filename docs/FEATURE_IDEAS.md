# Đề xuất tính năng và thiết kế lại giao diện

Tài liệu này gồm bốn phần:

1. Các emulator và công cụ chơi game RPG Maker đã tham khảo.
2. Cộng đồng người chơi dùng gì và than phiền gì nhiều nhất.
3. Thứ tự ưu tiên thi công, xếp theo **giá trị cho người chơi**, không theo độ dễ làm.
4. Thiết kế lại cách sắp xếp, nhóm và icon các nút.

Chưa có gì ở đây được thi công.

## 1. Công cụ đã tham khảo

| Công cụ | Loại | Tính năng đáng chú ý |
|---|---|---|
| **JoiPlay** (Android) | Trình chạy RPG Maker / Ren'Py | Gamepad ảo, chỉnh phím, menu cheat dựng sẵn cho MV (icon cây đũa), tua nhanh gán vào nút vai, dùng được save từ PC |
| **Maldives Player** (Android) | Trình chạy RPG Maker MV | Chạy MV trên điện thoại, đối thủ trực tiếp của JoiPlay |
| **EasyRPG Player** | Trình chạy RPG Maker 2000/2003 | Tua nhanh 2 mức (giữ nửa / giữ hết cò RT), menu Settings trong game (Video, Audio, Input, Engine) |
| **RetroArch / emulator console** | Emulator | Quick menu (game tạm dừng khi mở), save state, tua nhanh, chụp màn hình, shader, remap tay cầm |
| **MTool** (PC + Android) | Công cụ cho người chơi RPG Maker / Wolf / Tyrano… | Dịch máy trực tiếp khi chơi, tăng tốc cả game bằng một phím, tăng tốc đi, god mode, sửa số lượng vật phẩm. Kéo thả là chơi, không sửa file game |
| **Translator++** | Công cụ dịch | Trích text, dịch máy rồi sửa tay, xuất bản patch |
| **Cheat Menu (emerladCoder), Yanfly Cheat Menu, AkerCheats** | Plugin / mod cheat MV/MZ | God mode, hồi đầy, sửa EXP / chỉ số / vàng / vật phẩm, đi xuyên tường, tốc độ di chuyển, sửa switch / biến, lưu / dịch chuyển tới vị trí, lưu ở bất cứ đâu |
| **Enhanced Debug Screen (F9), RMSE / save editor online** | Debug / sửa save | Sửa switch / biến có tìm kiếm, sửa save ngoài game (dự án đã có 💾 Saves) |
| **Plugin quicksave, autosave, message skip, battle speed** | Plugin cho nhà làm game | Cho thấy người chơi hay đòi gì: lưu nhanh, tự lưu, lướt thoại, đánh nhanh |
| **Trình đọc visual novel (Ren'Py, KiriKiri…)** | Engine VN | Backlog, Auto, Skip, nút Q.Save / Q.Load luôn hiện |

## 2. Cộng đồng người chơi dùng gì nhiều nhất

Nguồn: Steam Discussions của RPG Maker MV, diễn đàn rpgmakerweb, bình luận itch.io trên trang game và trang plugin, diễn đàn Weight Gaming, Platinmods, trang giới thiệu và hướng dẫn JoiPlay / MTool. Không có số liệu đo lường chính thức; phần dưới là những gì **lặp lại nhiều lần** ở các nguồn đó.

| Nhu cầu | Bằng chứng | Mức độ |
|---|---|---|
| **Tăng tốc game** (đi lại, grind, cảnh dài) | Là tính năng tiêu đề của MTool ("tăng tốc cả game bằng một phím"), có sẵn trong JoiPlay và EasyRPG; hướng dẫn JoiPlay khuyên gán vào nút vai. Nhiều plugin "game speed toggle" | Rất cao |
| **Lướt thoại / chạm là hiện cả câu** | Người chơi than chữ gõ quá chậm, phải chờ xong mới sang câu; người chơi lại cảnh cũ đòi nút skip; ngược lại có người đọc chậm than chữ chạy quá nhanh (cần Auto chỉnh được tốc độ). Có cả mẹo "giữ Ctrl để lướt" | Rất cao |
| **Không mất save** | Than phiền thường gặp với bản web và điện thoại: xóa dữ liệu trình duyệt là mất save, Safari không giữ save, đổi trình duyệt là mất, không chép được save ra khỏi app Android | Rất cao |
| **Cheat** (vàng, vật phẩm, chỉ số, god mode) | JoiPlay và MTool đều dựng sẵn; có nhiều plugin / mod cheat riêng (emerladCoder, Yanfly, AkerCheats); trang save editor online nổi tiếng | Cao |
| **Dịch game** (chủ yếu game tiếng Nhật) | Lý do chính người ta dùng MTool; Translator++ và các hướng dẫn dịch máy được chia sẻ nhiều. Người chơi cũng chê chất lượng dịch máy, nên cần cho sửa / thay câu | Cao (với game ngoại ngữ) |
| **Lưu ở bất cứ đâu / tự lưu** | Nhiều plugin quicksave / autosave, bình luận xin gán phím, xin tự lưu sau trận boss | Cao |
| **Chơi trên điện thoại cho trơn tru** | JoiPlay / Maldives tồn tại chính vì nhu cầu này; than phiền máy yếu, tải chậm, phải cấp quyền mới chạy | Cao |
| **Mở khóa gallery / sửa switch** | Thường gặp ở cộng đồng game doujin: dùng F9 / switch editor để mở phòng hồi tưởng, gỡ kẹt event | Trung bình |
| **Đánh nhanh, luôn chạy** | Plugin battle speed, các plugin "always dash" | Trung bình (phần lớn đã được tua nhanh giải quyết) |
| **Remap phím, tay cầm thật** | Có trong JoiPlay / RetroArch nhưng ít được nhắc trong cộng đồng RPG Maker | Thấp–trung bình |
| **Chụp màn hình, shader, rung** | Phổ biến ở emulator console, gần như không được nhắc trong cộng đồng RPG Maker | Thấp |

## 3. Thứ tự ưu tiên thi công

Xếp theo giá trị cho người chơi. Cột "Công sức" chỉ để tham khảo (**S** vài giờ, **M** 1–3 ngày, **L** hơn 3 ngày), không ảnh hưởng tới thứ tự.

### Nhóm A: làm trước (người chơi dùng nhiều nhất)

| Thứ tự | Tính năng | Vì sao đứng ở đây | Cách tích hợp | Công sức |
|---|---|---|---|---|
| 1 | **Tua nhanh** ×2 / ×3 / ×4. Chạm = bật / tắt, giữ = tạm tăng tốc. Khi đang tua, thoại tự sang câu | Nhu cầu số 1 ở mọi công cụ và cộng đồng | Plugin mới `RWK_Speed`: `SceneManager.updateMain` chạy `updateScene` N lần mỗi frame; âm thanh giữ tốc độ thường. Nút ⏩ trên thanh công cụ | S |
| 2 | **Chế độ đọc thoại**: chạm là hiện hết câu, Auto (chỉnh được tốc độ cho người đọc chậm), Skip | Than phiền lặp lại nhiều nhất về trải nghiệm đọc | Patch `Window_Message`. Không bao giờ tự chọn hộ ở hộp lựa chọn, dừng Skip khi có lựa chọn / nhập số | S |
| 3 | **Save an toàn**: quick save / quick load ở map (cả khi game tắt lưu), tự lưu định kỳ vào slot riêng, chỉ báo trạng thái đồng bộ, xin `navigator.storage.persist()` để trình duyệt không xóa save | Mất save là nỗi sợ lớn nhất khi chơi trên web / điện thoại; dự án đã có cloud sync nên chỉ cần cho người chơi **thấy** và **dùng nhanh** | Slot `quick` và `auto` đi qua `RWK_SaveSync`; icon đám mây trên thanh công cụ đổi theo trạng thái (đã đồng bộ / đang tải / offline / xung đột) | M |
| 4 | **Khôi phục bản save cũ** (lịch sử trên cloud) | Lưới an toàn cuối cùng: save hỏng, chọn nhầm bản lúc xung đột, lỡ ghi đè | `worker/saves.js` chép bản cũ sang `saves/<user>/<slug>/.history/…`, giữ N bản; mục "Bản cũ" trong Saves | M |
| 5 | **Cheat cơ bản**: vàng, vật phẩm, EXP / level, chỉ số, hồi đầy, god mode, thắng trận ngay | Có sẵn trong cả JoiPlay lẫn MTool; người chơi đã quen có nó | Plugin `RWK_Cheats`, mặc định tắt, bật bằng `cheats: true` hoặc ngay trong menu (có xác nhận). Giao diện DOM có ô tìm kiếm, lấy tên từ `$dataItems`, `$dataActors` | M |
| 6 | **Chơi mượt trên 4G / offline**: Service Worker cache (đã có trong ROADMAP), cài như app (PWA), giữ màn hình sáng | Tải lại ảnh 10–27 MB mỗi lần mở là trải nghiệm tệ nhất trên điện thoại; màn hình tự tắt giữa đoạn thoại dài rất khó chịu | `rwk-sw.js` + `manifest.webmanifest` (icon từ `icon/` của game) + Screen Wake Lock API | M |

### Nhóm B: giá trị cao cho một phần người chơi

| Thứ tự | Tính năng | Vì sao | Cách tích hợp | Công sức |
|---|---|---|---|---|
| 7 | **Dịch game trực tiếp** + font có đủ dấu tiếng Việt | Lý do chính người ta dùng MTool; chỉ cần cho game ngoại ngữ nhưng với nhóm đó là bắt buộc | Worker dịch câu thoại / tên vật phẩm, cache trong R2 theo hash câu, dùng chung cho mọi thiết bị. Cho phép sửa câu dịch ngay trong game (người chơi chê dịch máy). Đổi font khi bật dịch | L |
| 8 | **Cheat nâng cao**: sửa switch / biến có tìm theo tên, mở gallery, đi xuyên tường, dịch chuyển, nhớ vị trí | Gỡ kẹt event, mở phòng hồi tưởng | Các tab thêm của `RWK_Cheats` | M |
| 9 | **Luôn chạy / tăng tốc đi** | Đỡ phải giữ X; tua nhanh không thay được khi muốn nghe nhạc ở tốc độ thường | Công tắc trong menu, lưu theo trình duyệt | S |
| 10 | **Lịch sử hội thoại (backlog)** | Đi kèm Auto / Skip: lỡ lướt qua thì đọc lại được | Ghi tên + nội dung từ `Window_Message`, bỏ mã điều khiển | M |
| 11 | **Báo lỗi dễ hiểu + gỡ kẹt** | Game lỗi trên điện thoại thường chỉ ra màn hình đen, người chơi không biết làm gì | Bắt `window.onerror`, hiện plugin gây lỗi, nút "Thử tiếp tục", "Về map an toàn", "Sao chép log" | S |
| 12 | **Chỉnh phím tay cầm / bàn phím** (gán cả tua nhanh, quick save) | Hữu ích cho người dùng tay cầm Bluetooth và bàn phím | Bảng gán phím, sửa `Input.gamepadMapper` / `Input.keyMapper` | M |

### Nhóm C: để sau

| Thứ tự | Tính năng | Ghi chú | Công sức |
|---|---|---|---|
| 13 | Tăng tốc trận đánh / bỏ animation riêng | Phần lớn đã được tua nhanh (#1) giải quyết | M |
| 14 | Bản dịch dạng patch (lệnh CLI `extract-text`, áp lúc build) | Cho người làm bản dịch, không phải người chơi thường; dùng chung dữ liệu với #7 | L |
| 15 | Chụp màn hình + chia sẻ | Ít được nhắc | S |
| 16 | Rung khi bấm nút ảo | Safari trên iPhone không hỗ trợ `navigator.vibrate` | S |
| 17 | Tùy chọn hiển thị (ảnh nét pixel, scale số nguyên, giới hạn 30 FPS, hiện FPS) | Ít được nhắc; 30 FPS có ích cho pin | M |
| 18 | Thư viện game `/` + thời gian chơi | Chỉ có ích khi có nhiều game | M |
| 19 | Nén ảnh / nhạc lúc build | Chỉ cần khi #6 chưa đủ | L |

### Không khuyến nghị

| Tính năng | Lý do |
|---|---|
| Rewind, save state kiểu emulator | Trạng thái game RPG Maker nằm rải rác trong rất nhiều object và plugin; #3 + #4 đã đáp ứng nhu cầu |
| Chơi mạng, thành tựu | Không có nhu cầu trong cộng đồng RPG Maker |
| Giải mã / xuất tài nguyên game | Không cần để chơi và đi ngược mục "dùng có trách nhiệm" |

## 4. Thiết kế lại các nút

### Hiện tại

- Thanh công cụ trái: ⚙ Tools, ⌨ Game keys. Phải: ⛶ toàn màn hình, 👁 ẩn / hiện.
- Menu ⚙ là một danh sách phẳng: Edit button layout, Saves, Use several items at once.
- Khi thêm tính năng ở mục 3, danh sách phẳng sẽ dài hơn 15 mục và khó tìm.

### Nguyên tắc

1. **Dùng nhiều thì một chạm, dùng ít thì vào menu.** Tua nhanh và trạng thái save nằm ngay trên thanh công cụ; chỉnh layout, gán phím nằm sâu trong menu (giống thanh Q.Save / Skip / Auto luôn hiện của các engine VN).
2. **Game tạm dừng khi menu mở** (giống quick menu của RetroArch, JoiPlay). Chỉnh cheat hay đổi tốc độ không bị quái đánh trong lúc đó.
3. **Nhóm theo việc người chơi muốn làm**, không theo plugin nào làm ra nó.
4. **Icon nét đơn (outline) cùng một bộ**, đúng nghĩa quen thuộc. Mọi icon có nhãn chữ trong menu; trên thanh công cụ có `aria-label` và tooltip.
5. **Không trùng nghĩa với nút của game.** Nút Y của gamepad đã có nhãn "Menu" (menu của game), nên nút của toolkit không dùng ☰ hay chữ "Menu". Chọn ⏸ (tạm dừng): người chơi hiểu ngay là game dừng lại, và cặp ⏸ ⏩ là cặp quen thuộc của trình phát media.
6. **Vùng chạm tối thiểu 44 × 44 px**, nút nguy hiểm (xóa save, cheat) phải xác nhận, và để xa các nút hay bấm.

### Thanh công cụ mới

```
Ngang (landscape)
┌───────────────────────────────────────────────────────────────┐
│ ⏸  ⌨                                            ☁  ⏩×2  👁 │
│                                                               │
│                         (màn hình game)                       │
│   [L]                                                   [R]   │
│   ✚ D-pad                                           Y X B A   │
└───────────────────────────────────────────────────────────────┘

Dọc (portrait)
┌─────────────────────────────┐
│        (màn hình game)      │
├─────────────────────────────┤
│ [L]  ⏸  ⌨      ☁  ⏩  👁 [R]│
│   ✚ D-pad          Y X B A  │
└─────────────────────────────┘
```

| Vị trí | Nút | Icon | Hành vi |
|---|---|---|---|
| Trái | **Tạm dừng + menu nhanh** | `pause` (⏸) | Dừng game, mở menu nhanh. Thay cho ⚙ |
| Trái | Phím của game | `keyboard` (⌨) | Như hiện tại; chỉ hiện khi game có phím plugin |
| Phải | **Trạng thái save** | `cloud-check` / `cloud-upload` / `cloud-off` / `cloud-alert` | Chỉ để xem, chạm để mở mục Save. Chỉ hiện khi bật sync |
| Phải | **Tua nhanh** | `fast-forward` (⏩) + nhãn `×2` | Chạm bật / tắt, giữ để tua tạm, nhấn giữ lâu để chọn tốc độ. Sáng màu khi đang tua |
| Phải | Ẩn / hiện nút | `eye` / `eye-off` | Như hiện tại |

⛶ toàn màn hình rời khỏi thanh công cụ và vào hàng thao tác nhanh của menu; ngoài ra lần chạm đầu tiên vào game trên điện thoại sẽ hỏi có vào toàn màn hình không.

Trên máy tính: nút ⏸ mờ ở góc trên trái như ⚙ hiện nay. Phím tắt đề xuất (CLI kiểm tra để không trùng phím plugin của game; tránh F2–F4 vì MZ đã dùng, tránh F5 vì là tải lại trang):

| Phím | Việc |
|---|---|
| `F1` | Mở menu nhanh |
| Giữ `Tab` | Tua nhanh tạm thời |
| `` ` `` | Bật / tắt tua nhanh |
| `F6` / `F7` | Quick save / quick load |

### Menu nhanh

Trên điện thoại dọc là bottom sheet, ngang là bảng trượt từ bên trái, máy tính là hộp thoại ở giữa. Hàng đầu là các ô lớn cho thao tác hay dùng, phía dưới là các nhóm.

```
┌──────────── ⏸ Tạm dừng ──────────── ✕ ┐
│  [💾 Lưu nhanh] [📂 Tải nhanh] [⛶ Toàn màn hình] [📷 Chụp] │
│                                                              │
│  ▶ Chơi                                                      │
│    Tốc độ           ( ×1 | ×2 | ×3 | ×4 )                    │
│    Thoại            ( Thường | Auto | Skip )   Lịch sử thoại │
│    Luôn chạy                                         [on]    │
│    Dùng nhiều vật phẩm một lúc                       [on]    │
│  ☁ Save              Đã đồng bộ 2 phút trước               › │
│  🪄 Cheat                                                    › │
│  🌐 Dịch                                             [off] › │
│  🎮 Điều khiển                                               › │
│  🖥 Hiển thị                                                 › │
│  ⓘ Trợ giúp & báo lỗi                                        › │
└──────────────────────────────────────────────────────────────┘
```

| Nhóm | Mục bên trong | Icon (tên trong bộ Lucide / Material Symbols) |
|---|---|---|
| Hàng thao tác nhanh | Lưu nhanh, Tải nhanh, Toàn màn hình, Chụp màn hình | `save`, `folder-open`, `maximize` / `minimize`, `camera` |
| Chơi | Tốc độ (segmented control), Thoại (Thường / Auto / Skip, kèm thanh chỉnh tốc độ Auto), Lịch sử thoại, Luôn chạy, Dùng nhiều vật phẩm một lúc, Đánh nhanh | `gauge`, `message-square-text`, `history`, `footprints`, `package`, `swords` |
| Save | Trạng thái đồng bộ, danh sách slot (Xuất / Nhập / Xóa như hiện tại), Bản cũ, Tự lưu (khoảng thời gian) | `cloud-check`, `download`, `upload`, `trash-2`, `history`, `timer` |
| Cheat | Tabs: Nhóm (HP / MP / chỉ số / level / god mode), Vật phẩm & vàng, Switch & biến, Di chuyển (xuyên tường, dịch chuyển, nhớ vị trí). Chỉ hiện khi bật; lần đầu bật phải xác nhận | `wand-sparkles` (giống JoiPlay), `users`, `coins`, `toggle-right`, `map-pin` |
| Dịch | Bật / tắt, ngôn ngữ đích, sửa câu đang hiện, đổi font | `languages`, `pencil`, `type` |
| Điều khiển | Sửa vị trí nút (✥ như hiện tại), độ mờ, kích thước, rung, gán phím tay cầm / bàn phím, hiện khi nào (touch / luôn / không) | `move`, `blend`, `scaling`, `vibrate`, `gamepad-2` |
| Hiển thị | Ảnh nét / mượt, kiểu scale, giới hạn FPS, hiện FPS, giữ màn hình sáng | `monitor`, `image`, `battery`, `sun` |
| Trợ giúp & báo lỗi | Danh sách phím tắt, nhật ký lỗi, phiên bản toolkit | `info`, `bug`, `keyboard` |

Gợi ý thêm:

- Icon giữ cách vẽ hiện tại (SVG nét đơn theo màu chữ trong `RWK.icons`), chỉ chép thêm hình từ một bộ icon có giấy phép mở (Lucide, ISC) để nét vẽ đồng đều.
- `RWK.tools.add` thêm trường `group` (`play`, `save`, `cheat`, `translate`, `controls`, `display`, `help`) và `quick: true` cho các ô ở hàng đầu, để mỗi plugin tự đăng ký vào đúng nhóm.
- Nhóm nào chỉ có một mục thì mở thẳng mục đó, không qua màn hình con.
- Nhớ nhóm mở lần trước và tốc độ tua đã chọn theo từng trình duyệt (như `itemBatch` hiện tại).

## Nguồn

- [JoiPlay setup guide](https://retrohandheldhq.com/posts/joiplay-setup-guide/), [JoiPlay (RPG Maker wiki)](https://rpgmaker.fandom.com/wiki/JoiPlay), [JoiPlay setup & tweaks (Platinmods)](https://platinmods.com/threads/how-to-play-rpg-maker-and-renpy-games-on-android-with-joiplay-step-by-step-guide.267047/), [JoiPlay vs Maldives Player](https://appgrooves.com/compare/android-cyou.joiplay.joiplay/android-net.miririt.maldivesplayer), [Weight Gaming: RPG Maker games on JoiPlay](https://forum.weightgaming.com/t/rpg-maker-games-playable-with-joiplay-on-android/24017)
- [MTool](https://mtool.app/?lang=en), [Mtool: automatic translation for RPG Maker games](https://www.madinfinite.com/news/mtool-automatic-translation-for-rpgmaker-games/), [MTool alternative comparison](https://runetranslate.com/compare/mtool)
- [Translator++](https://dreamsavior.net/translator-plusplus/), [Weight Gaming: machine translating Japanese RPG Maker games](https://forum.weightgaming.com/t/how-to-machine-translate-japanese-rpg-maker-games/10185)
- [EasyRPG settings menu](https://wiki.easyrpg.org/user/player/settings-menu), [EasyRPG buttons](https://wiki.easyrpg.org/user/player/buttons)
- [RPG Maker MV Cheat Menu Plugin (emerladCoder)](https://github.com/emerladCoder/RPG-Maker-MV-Cheat-Menu-Plugin), [Yanfly Cheat Menu](https://yanfly.moe/?p=6544), [AkerCheats](https://waldorf.itch.io/akercheats)
- [Steam: skip text / fast forward in MV](https://steamcommunity.com/app/363890/discussions/0/1743355067100122391/), [rpgmakerweb: text speed](https://forums.rpgmakerweb.com/threads/feel-like-a-newb-again-but-text-speed.47654/), [rpgmakerweb: Shift skips dialogue](https://forums.rpgmakerweb.com/threads/shift-button-a-by-default-skips-dialogue-text.21916/), [Kadajah's Dialogue Skip Button](https://kadajah.itch.io/kadajahs-skiptext)
- [rpgmakerweb: players lose their save files](https://forums.rpgmakerweb.com/threads/some-of-my-players-lose-their-save-files-when-coming-back-to-the-game.154650/), [Steam: save/load in a browser](https://steamcommunity.com/app/363890/discussions/0/483366528924992882/), [rpgmakerweb: Android save data](https://forums.rpgmakerweb.com/threads/android-save-data.117557/)
- [Quicksave/Quickload MV](https://tamschi.itch.io/quicksave-quickload), [Xy_AutoSave](https://xyscripts.itch.io/xyautosave), [Felski Autosave](https://felski.itch.io/autosave), [HimeWorks Speed Hack](https://himeworks.com/?p=6094), [Game speed toggle plugin](https://axial-escape.itch.io/game-speed-toggle-plugin-for-rpg-maker-mv), [Carvalho Battle Speed](https://carvalhopluginsrpgmakermv.itch.io/carvalho-battle-speed-optimize-your-rpg-maker-mv-battles-like-a-pro/purchase), [Enhanced Debug Screen for MZ](https://leashagamesdev.itch.io/enhanced-debug-screen-for-rpg-maker-mz)
- [Game accessibility guidelines](https://gameaccessibilityguidelines.com/?p=1119), [Xsolla: virtual gamepad](https://developers.xsolla.com/distribute-game/cloud-gaming/how-to/set-up-virtual-gamepad/), [Turning off touch controls on Xbox Cloud Gaming](https://inairspace.com/blogs/learn-with-inair/how-to-turn-off-touch-controls-on-xbox-cloud-gaming-for-a-better-experience)
