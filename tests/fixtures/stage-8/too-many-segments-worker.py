import json
import sys

json.load(sys.stdin)
text = "x" * 129
json.dump(
    {
        "status": "OK",
        "blocks": [
            {
                "text": text,
                "selectors": [],
                "segments": [
                    {"start": index, "end": index + 1, "selectors": []}
                    for index in range(129)
                ],
            }
        ],
    },
    sys.stdout,
)
