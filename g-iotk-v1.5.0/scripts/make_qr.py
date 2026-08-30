import sys
import qrcode
payload = sys.argv[1]
img = qrcode.make(payload)
img.save(sys.stdout.buffer, format='PNG')
