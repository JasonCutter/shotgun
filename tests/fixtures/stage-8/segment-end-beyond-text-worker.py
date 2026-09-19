import json
import sys

json.load(sys.stdin)
json.dump(
    {
        "status": "OK",
        "blocks": [
            {
                "text": "abc",
                "selectors": [],
                "segments": [{"start": 0, "end": 4, "selectors": []}],
            }
        ],
    },
    sys.stdout,
)
