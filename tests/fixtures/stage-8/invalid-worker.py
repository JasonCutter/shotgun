import json
import sys

json.load(sys.stdin)
json.dump({"status": "OK", "blocks": [{"selectors": []}]}, sys.stdout)
