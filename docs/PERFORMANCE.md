# Hiệu năng của các plugin runtime

Tài liệu này trả lời: các plugin `runtime/RWK_*.js` làm game chậm đi bao nhiêu, cái nào đáng tối ưu. Số liệu đo bằng công cụ `tools/perf/` (cách dùng trong [CONTRIBUTING.md](../CONTRIBUTING.md#runtime-performance-toolsperf)), đo lại sau mỗi thay đổi ở plugin chạy mỗi frame.

## 1. Công cụ đo

`npm run perf -- "<thư mục game>"` mở game thật trong Chrome headless, mỗi lần với một bộ plugin khác nhau, và so với lần chạy **không có plugin nào của toolkit** (`none`):

| Biến thể | Plugin |
|---|---|
| `none` | không plugin toolkit nào (mốc so sánh) |
| `all` | tất cả, như bản deploy |
| `+X` (`each`) | `RWK_Core` + một plugin X, để biết chi phí thuộc về plugin nào |
| `-X` | tất cả trừ X |

Mỗi lần chạy: New Game, rồi đo

| Kịch bản | Đo gì |
|---|---|
| Hooks, same page | Gọi xen kẽ hàm gốc của engine và hàm đã bị hook **trong cùng một trang** (cùng trạng thái JIT), lấy ns/lần gọi × số lần gọi/frame. Con số chính xác nhất cho chi phí mỗi frame. |
| Logic, walking / messages | Logic game mỗi frame (vòng lặp game dừng, không vẽ) khi nhân vật đi vòng trên map và khi đọc hội thoại. So giữa các lần tải trang nên nhiễu hơn (JIT, GC) |
| realtime | Game chạy và vẽ 4 giây: CPU mỗi frame p50/p95, % frame > 20 ms, thời gian style + layout của trình duyệt (bàn phím ảo luôn bật) |
| save | Một lần lưu trên map như autosave làm: thời gian chặn luồng chính, CPU trong 2,5 giây kể cả upload lên cloud (Worker thật, bucket trong RAM) |
| audio | Phát 6 BGM + 6 SE rồi dừng, ép GC, đếm `WebAudio` còn sống và dung lượng âm thanh đã giải mã còn bị giữ |
| resize | 4 lần xoay dọc/ngang kiểu điện thoại |
| boot, heap | Thời gian từ lúc tải trang đến scene đầu tiên; JS heap sau GC |

Plugin đo `RWK_Perf` (chỉ có trong công cụ, không bao giờ deploy) còn ghi lại hàm engine nào bị plugin nào thay, và hàm nào được gọi mỗi frame. Random được cố định seed để NPC đi giống nhau ở mọi biến thể. Một khác biệt so với `none` bị đánh dấu `!` khi vượt ngưỡng của chỉ số (trong `tools/perf/stats.js`) **và** vượt 2 lần độ dao động giữa các vòng.

**Giới hạn.** Chrome headless không có GPU như điện thoại; `--cpu 4` chỉ làm chậm CPU. Ở CPU ×4, game MZ nặng vẽ không kịp 60 fps ngay cả khi không có toolkit, nên số liệu frame rất nhiễu: dùng nó để so sánh, không phải để đoán fps thật trên máy. Các số "Logic" so giữa các lần tải trang dao động ±10–20 %; số "Hooks, same page" thì không bị ảnh hưởng.

## 2. Kết quả (25/10/2026)

Hai game: *GameDev: The Beginning* (MV, nhỏ, CPU ×1, 3 vòng, 12 biến thể) và *Enishia and the Binding Brand* (MZ, lớn, CPU ×4 như điện thoại tầm trung, 3 vòng, 7 biến thể). Chrome 155, Windows 11.

### Mỗi frame: không đáng kể

Chỉ 6 hàm bị hook được gọi trong lúc chơi bình thường (MV, đi bộ + hội thoại):

| Hàm | Lần gọi/frame | Thêm mỗi lần gọi | Plugin |
|---|---|---|---|
| `Window_Message.prototype.isTriggered` | 4,7 | ~7 ns | Message |
| `Input.update` | 1 | ~60 ns | MobileControls |
| `Game_Interpreter.prototype.setup` | 1 (common event song song) | ~80 ns | ItemBatch |
| `Window_Message.prototype.update` | 1 | ~20 ns | Message |
| `Window_Message.prototype.isAnySubWindowActive` | 0,8 | ~6 ns | ItemBatch |
| `SceneManager.updateScene` | 1 | dưới ngưỡng đo | Core, Speed |

Tổng: **dưới 1 µs mỗi frame** với tất cả plugin, tức dưới 0,01 % ngân sách 16,7 ms của một frame 60 fps (kể cả nhân 4 cho điện thoại). Logic mỗi frame, CPU mỗi frame và style/layout của `all` đều nằm trong độ nhiễu so với `none` ở cả hai game. Bàn phím ảo không gây style/layout mỗi frame (≈ 0 ms/s ở MV).

### Thỉnh thoảng

| Chỉ số | `none` | `all` | Ghi chú |
|---|---|---|---|
| 4 lần xoay, CPU (MV, ×1) | 17–21 ms | +39–43 ms | Do `+MobileControls` (+27–39 ms) |
| 4 lần xoay, CPU (MZ, ×4) | 131 ms ±56 | +321 ms | `+MobileControls` +397 ms `!`: **~100 ms mỗi lần xoay** trên máy chậm |
| Lưu game chặn luồng (MV, ×1) | 31 ms | không khác | Lưu của engine (JSON + nén), toolkit không thêm gì đo được |
| Lưu game chặn luồng (MZ, ×4) | 347 ms | +88 ms | Trong độ nhiễu (dao động giữa các vòng tới ±100 ms) |
| Boot (MV, ×1) | 470 ms ±73 | +150–200 ms | Mỗi plugin là một file tải riêng; dưới ngưỡng 300 ms |

### Bộ nhớ: một lỗi thật

| | `none` | `+Report` / `all` |
|---|---|---|
| MV: `WebAudio` còn sống sau khi dừng nhạc | 4 | **16** (+12: tất cả 6 BGM + 6 SE vừa phát) |
| MV: âm thanh đã giải mã bị giữ | 0,5 MB | **88,7 MB** (+88 MB) |
| MZ: `WebAudio` còn sống | 4 | 16 (+12) |
| MZ: âm thanh đã giải mã bị giữ | 0,45 MB | 0,45 MB |

`RWK_Report` giữ tham chiếu mạnh tới 100 `WebAudio` gần nhất (`MAX_BUFFERS`) để báo file nào lỗi. Trên MV, `stop()` không giải phóng `_buffer` (PCM float32 đã giải mã: 1 phút nhạc stereo 44,1 kHz ≈ 21 MB; trung bình ~15 MB mỗi BGM ở game đo), nên mọi bản nhạc vừa phát bị giữ lại đến khi bị 100 âm thanh mới hơn đẩy ra. MZ tự `destroy()` buffer khi dừng nên chỉ giữ vỏ đối tượng.

## 3. Kế hoạch tối ưu

| # | Việc | Ưu tiên | Công | Lý do |
|---|---|---|---|---|
| 1 | `RWK_Report`: không giữ `WebAudio` | **Cao** | S | MV giữ hàng chục–hàng trăm MB âm thanh: trên điện thoại (iOS Safari giới hạn bộ nhớ tab chặt) dễ làm tab bị nạp lại hoặc crash sau một lúc chơi, mất tiến trình chưa lưu |
| 2 | `RWK_MobileControls`: gộp các lần layout khi xoay màn hình | Trung bình | S | ~100 ms giật mỗi lần xoay trên máy chậm |
| 3 | Gộp các file `RWK_*.js` khi build | Thấp | S–M | Boot +150–200 ms trên máy, nhiều hơn khi mạng chậm (11 request tuần tự) |
| 4 | Đo autosave với save lớn | Thấp, cần đo trước | S | Lưu của engine đã chặn ~350 ms trên MZ ở CPU ×4 với save New Game; autosave làm việc này giữa lúc chơi mà người chơi không chờ |

Không cần tối ưu: các hook mỗi frame (Message, ItemBatch, MobileControls, Core, Speed). Chi phí của chúng nhỏ hơn độ nhiễu đo hàng trăm lần.

### 1. `RWK_Report` giữ âm thanh (cao)

`runtime/RWK_Report.js`, `AudioManager.createBuffer`: thay `buffers.push({ buffer, file })` bằng `{ ref: new WeakRef(buffer), file }` và `deref()` khi lập báo cáo (bỏ qua những cái đã bị thu hồi). Một buffer lỗi vẫn còn trong báo cáo nếu engine còn giữ nó; muốn giữ cả lỗi của buffer đã bị thu hồi thì ghi tên file lỗi lúc nó lỗi (kiểm tra `isError()` trong `addLoadListener` / lần kế tiếp) thay vì giữ đối tượng. `WeakRef` có từ Chrome 84, Safari 14.1.

Kiểm tra: `npm run perf -- "<game MV>" --variants none,+Report --scenarios audio --rounds 2`: *Audio kept* của `+Report` phải bằng `none`.

### 2. Xoay màn hình (trung bình)

Mỗi lần xoay, `relayout()` chạy cho từng sự kiện `resize`, `orientationchange`, `screen.orientation change` (và `fullscreenchange`), mỗi lần đặt thêm 2 hẹn giờ (150 và 500 ms) gọi `Graphics._updateAllElements()`. Hàm này lại bị hook để gọi `layout()`, và trên MZ còn đổi kích thước canvas WebGL. `layout()` xen kẽ đọc (`offsetWidth`, `getBoundingClientRect`) và ghi `style`, nên mỗi lần đọc buộc trình duyệt tính lại layout.

Hướng sửa:
- Gộp: các sự kiện chỉ đánh dấu "cần layout", layout chạy một lần trong `requestAnimationFrame` kế tiếp; hai lần "settle" chỉ đặt lại nếu kích thước cửa sổ thật sự đổi.
- Trong hook `Graphics._updateAllElements`, bỏ qua nếu kích thước canvas và cửa sổ không đổi từ lần layout trước.
- Trong `layout()`: đọc hết kích thước trước, ghi `style` sau.

Kiểm tra: `--variants none,+MobileControls --scenarios resize --cpu 4 --rounds 3`, *4 rotations CPU* về gần `none`.

### 3. Boot (thấp)

Có thể để CLI nối các `RWK_*.js` thành một file `RWK_All.js` khi build (giữ nguyên thứ tự, mỗi plugin vẫn là một IIFE). Đo lại boot trước: trên máy cục bộ chênh lệch +150–200 ms còn dưới ngưỡng và nhiễu ±70 ms; đáng làm nếu đo trên mạng thật (Cloudflare, 4G) cho thấy lớn hơn. Đồng bộ save lúc boot (`RWK_SaveSync`) chỉ thêm một request khi không có gì để tải và là thiết kế có chủ đích (engine phải đọc save sau khi đồng bộ).

### 4. Autosave với save lớn (cần đo)

Toolkit không làm việc lưu chậm hơn, nhưng autosave (5 phút một lần, trên map) làm cùng công việc với lưu thủ công, giữa lúc người chơi đang đi. Công cụ hiện chỉ đo save của New Game (vài chục KB); save sau nhiều giờ chơi có thể lớn gấp 10–50 lần. Bước tiếp theo: cho công cụ nạp một file save thật (`--save <file>`) rồi đo lại. Nếu một lần lưu chặn quá ~100 ms trên điện thoại, hướng sửa là chờ lúc người chơi đứng yên vài giây, hoặc lúc mở menu, rồi mới autosave.
