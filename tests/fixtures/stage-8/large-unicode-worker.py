import json
import sys

sys.stdout.reconfigure(encoding="utf-8")
json.load(sys.stdin)
json.dump(
    {
        "status": "OK",
        "blocks": [
            {
                "text": "😀" * 1100000,
                "selectors": [{"type": "PageSelector", "page": 1}],
            }
        ],
    },
    sys.stdout,
    ensure_ascii=False,
)
