.jobs[] | select(.conclusion == "failure") | {name, steps: [.steps[] | select(.conclusion == "failure") | {stepName, conclusion}]}
