# Roadmap

## Giai đoạn 2: ưu tiên cao

### Service Worker lưu đệm file game (quan trọng khi chơi bằng 4G)

Hiện tại mỗi lần mở game, trình duyệt chỉ dựa vào HTTP cache. Cache này dễ bị xoá trên điện thoại, và các ảnh parallax nặng 10–27 MB sẽ bị tải lại nhiều lần.

Dự kiến:

- `rwk-sw.js` do build sinh ra, cache-first cho `img/ audio/ effects/ data/ js/ fonts/`.
- Mỗi lần build tạo một `buildId` (hash của manifest) dùng làm tên cache. Khi có bản deploy mới, Service Worker xoá cache cũ và **chỉ tải lại file đã đổi** (so hash theo từng file, không xoá cả cache).
- Không cache `/api/*`. Nên không cache file trên 25 MiB, hoặc cache có giới hạn, vì iOS giới hạn dung lượng.
- Tuỳ chọn "Tải trước" trong menu: tải sẵn các map/nhạc khi đang dùng Wi-Fi.
- Rủi ro: iOS Safari giới hạn quota và có thể xoá dữ liệu sau 7 ngày không mở. Cần hiển thị dung lượng đã cache và có nút xoá cache.

### Kiểm thử MV

Adapter MV (`RWK_SaveSync`: localStorage `RPG File%d`; boot gate qua `SceneManager.run`) đã viết nhưng chưa được kiểm thử trên game thật.

## Giai đoạn 3

- Đồng bộ save cho bản PC (NW.js): plugin tuỳ chọn để bản desktop cũng đẩy và kéo save, dùng service token của Access.
- Tự động bật Cloudflare Access qua API (cần API token có quyền Access) thay cho bước bật thủ công trong dashboard.
- Hỗ trợ macOS và Linux (`rwk.sh`). Phần CLI đã viết đa nền tảng, chủ yếu cần thêm script khởi chạy và cách mở trình duyệt.
- Trang `/` liệt kê các game đã deploy (hub cá nhân).
