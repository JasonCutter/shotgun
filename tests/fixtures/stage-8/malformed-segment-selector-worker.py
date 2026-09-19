import json
import sys

json.load(sys.stdin)
json.dump(
    {
        "status": "OK",
        "blocks": [
            {
                "text": "segment",
                "selectors": [],
                "segments": [
                    {
                        "start": 0,
                        "end": 7,
                        "selectors": [{"type": "PageSelector", "page": "bad"}],
                    }
                ],
            }
        ],
    },
    sys.stdout,
)
