import time
from http.server import HTTPServer, SimpleHTTPRequestHandler
import sys

### DO NOT USE THIS, I use it to troubleshoot performance in dev

# Constants for throttling
BYTES_PER_SECOND = 5 * 1024 * 1024  # 5MB/s
CHUNK_SIZE = 64 * 1024              # 64KB chunks

class ThrottledCORSRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200, "ok")
        self.end_headers()

    def copyfile(self, source, outputfile):
        """Override copyfile to introduce a delay between chunks."""
        start_time = time.time()
        bytes_sent = 0

        while True:
            block = source.read(CHUNK_SIZE)
            if not block:
                break

            outputfile.write(block)
            bytes_sent += len(block)

            # Calculate how long we SHOULD have taken to send this much data
            expected_time = bytes_sent / BYTES_PER_SECOND
            elapsed_time = time.time() - start_time

            # If we are ahead of schedule, sleep the difference
            if elapsed_time < expected_time:
                time.sleep(expected_time - elapsed_time)

if __name__ == '__main__':
    port = 8000
    if len(sys.argv) > 1:
        port = int(sys.argv[1])
    print(f"Starting throttled server (5MB/s) on port {port}...")
    HTTPServer(('0.0.0.0', port), ThrottledCORSRequestHandler).serve_forever()