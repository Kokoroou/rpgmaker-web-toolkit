# rpgmaker-web-toolkit

Đưa game **RPG Maker MZ** (MV: có adapter, chưa kiểm thử) lên **Cloudflare Workers miễn phí** chỉ với một lệnh:

- Chơi trên trình duyệt ở bất kỳ đâu: `https://<tên-game>.<username>.workers.dev`
- **Đồng bộ save qua cloud**: cùng một email đăng nhập thì chơi tiếp được trên mọi máy
- **Nút ảo trên điện thoại** cho các phím mà plugin của game dùng (R, T, Q, E…)
- Chạy lại bao nhiêu lần cũng được: lần sau **chỉ tải lên file đã thay đổi** (dùng khi có bản vá Việt hoá)
- **Không sửa thư mục game gốc**: mọi thay đổi chỉ nằm trong `.build/`

Giai đoạn hiện tại chỉ hỗ trợ **Windows**.

## Cài đặt & chạy

Yêu cầu: [Node.js](https://nodejs.org) 20+ (bản LTS) và Git.

```powershell
git clone https://github.com/Kokoroou/rpgmaker-web-toolkit
.\rpgmaker-web-toolkit\rwk.cmd "D:\Games\Ten Game"
```

Lần đầu, script sẽ:

1. Cài phụ thuộc (wrangler) nếu chưa có.
2. Phân tích game (MZ/MV, plugin, các phím đặc biệt) và hỏi vài câu: tên web, có bật đồng bộ save không, nhãn cho từng nút ảo.
   Câu trả lời được lưu ở `games/<tên>.json`.
3. Mở trình duyệt để đăng nhập Cloudflare (chỉ lần đầu trên mỗi máy).
4. Đưa file lớn hơn 25 MiB lên R2, deploy Worker cùng toàn bộ file game.
5. Hướng dẫn bật **Cloudflare Access** (đăng nhập bằng email). Trong lúc chưa bật, trang ở trạng thái **khoá**, chưa ai vào được.
6. Hỏi có tải các save đang có trên máy (thư mục `save/`) lên cloud không.

Khi có bản vá: chép bản vá đè vào thư mục game rồi chạy lại đúng lệnh trên. Nếu bản mới dùng thêm phím, script sẽ hỏi có thêm nút ảo không.

Sang máy khác: `git clone` (hoặc `git pull`) repo này, tải game về rồi chạy lệnh trên. Cấu hình trong `games/` được dùng lại, nên không phải trả lời lại các câu hỏi. **Nhớ commit và push thư mục `games/`** sau lần chạy đầu.

> Nếu repo để public, `games/*.json` sẽ lộ tên game và team Access của bạn. Hãy để repo private, hoặc thêm `games/` vào `.gitignore`.

### Lệnh khác

```powershell
rwk.cmd import-saves "D:\Games\Ten Game"   # tải lại save trên máy lên cloud (ghi đè bản cùng tên)
rwk.cmd help
```

## Cấu hình game: `games/<tên>.json`

| Khoá | Ý nghĩa |
|---|---|
| `slug` | Tên Worker, thành `<slug>.<username>.workers.dev` |
| `fingerprint` | Dùng để nhận ra game ở lần chạy sau (MZ: `advanced.gameId`, MV: tên game) |
| `include` | Thư mục/file ngoài cấu trúc chuẩn cần đưa lên (ví dụ `"live2d"`, hoặc glob `"extra/**"`) |
| `exclude` | Glob cần bỏ, ví dụ `"data-tw/**"`. Mặc định đã bỏ `*.zip *.rar *.7z *.psd *.bak *.log` và file ẩn |
| `sync.enabled` | Bật/tắt đồng bộ save |
| `auth` | `{ "mode": "access", "teamDomain", "aud" }` hoặc `{ "mode": "none" }`. Script tự điền |
| `controls` | Nút ảo, xem bên dưới |

### Nút ảo (`controls`)

```json
"controls": {
  "enabled": true,
  "showOn": "touch",
  "dpad": false,
  "opacity": 0.5,
  "scale": 1,
  "extras": ["fullscreen", "editLayout"],
  "buttons": [
    { "key": "r", "label": "Xem NPC" },
    { "key": "escape", "label": "Menu" },
    { "label": "Popup", "keys": [{ "key": "f", "label": "F" }, "e", "q"] }
  ]
}
```

- `key` là tên phím logic của RPG Maker (`ok`, `escape`, `pageup`…) hoặc tên phím mà plugin tự đăng ký (`r`, `t`…).
  Cũng có thể ghi số keyCode, khi đó tên phím được tra qua `Input.keyMapper`.
- Phần tử có `keys` là **nhóm nút**: chạm để mở ra các nút con.
- `showOn`: `touch` (chỉ hiện trên thiết bị cảm ứng), `always` hoặc `never`.
- Trong game, góc trên bên trái có các nút: ◐ ẩn/hiện, ⛶ toàn màn hình, ✥ kéo thả đổi vị trí nút (bố cục lưu riêng từng thiết bị), ↺ về bố cục mặc định.

## Kiến trúc

```
rwk.cmd ─► cli/            Node CLI: phân tích game, dựng .build/<slug>/, gọi wrangler
           runtime/        Plugin chèn vào bản web (thêm vào cuối js/plugins.js của bản build)
             RWK_Core            cấu hình, deviceId, toast, hộp thoại
             RWK_SaveSync        đồng bộ save (adapter MZ: localforage, MV: localStorage)
             RWK_MobileControls  nút ảo, điều khiển qua Input._currentState
           worker/         Worker dùng chung cho mọi game
             index.js            static assets + file lớn từ R2 (có Range) + /api
             auth.js             xác thực JWT của Cloudflare Access
             saves.js            API save, chống ghi đè bằng ETag
```

**Lưu trữ.** File tĩnh nằm trong Workers Static Assets (miễn phí, không giới hạn băng thông, tối đa 20.000 file và 25 MiB/file). Chỉ những file lớn hơn 25 MiB mới nằm trên R2. R2 dùng chung một bucket `rpgmaker-web-toolkit`:

```
assets/<slug>/<đường dẫn>          file > 25 MiB
assets/<slug>/.rwk-manifest.json   hash của các file trên, dùng để chỉ tải lại file đã đổi
saves/<sha256(email)>/<slug>/<tên>  save (config, global, file1…)
```

**Đồng bộ save.**

- Khi game khởi động (trước khi engine đọc save), plugin so sánh save trên máy với bản trên cloud. Bản nào mới hơn thì lấy bản đó. Nếu cả hai nơi đều đã thay đổi, game hỏi người chơi giữ bản nào.
- Mỗi lần game ghi save, plugin đẩy lên cloud sau khoảng 1 giây, kèm `If-Match` để không ghi đè lên thay đổi của máy khác.
- Lúc mất mạng thì save chỉ lưu trên máy và được đẩy lên lại khi có mạng.
- Nếu một máy khác vừa lưu trong vòng 5 phút, game cảnh báo để tránh hai máy ghi đè save của nhau.

**Bảo mật.** Cloudflare Access chặn mọi truy cập ở tầng mạng. Worker còn tự kiểm tra chữ ký JWT để biết email người chơi. Preview URL bị tắt (`preview_urls: false`), vì các URL đó không nằm trong phạm vi bảo vệ của Access.

## Giới hạn gói miễn phí cần biết

| Dịch vụ | Giới hạn | Ghi chú |
|---|---|---|
| Workers Static Assets | 20.000 file, 25 MiB/file | Quá 20.000 file thì dùng `exclude`, ví dụ bỏ ngôn ngữ thừa |
| Workers requests | 100.000/ngày | Chỉ `/api/*` và file trên R2 mới tính; file tĩnh không tính |
| R2 | 10 GB, 1 triệu lượt ghi, 10 triệu lượt đọc/tháng | Bật R2 cần thêm phương thức thanh toán vào account, dù vẫn dùng gói miễn phí |
| Cloudflare Access | 50 người dùng | Đủ cho dùng cá nhân |
| `wrangler r2 object put` | Khoảng 300 MiB/file | File lớn hơn thế sẽ báo lỗi |

## Phát triển

```powershell
npm test          # test CLI + Worker (node:test, không cần mạng)
```

Xem thêm [docs/ROADMAP.md](docs/ROADMAP.md).
