"""Stage 9 deterministic impact oracle backed by NetworkX."""

from __future__ import annotations

import json
import sys

import networkx as nx


def main() -> None:
    request = json.load(sys.stdin)
    graph = nx.DiGraph()
    edge_ids: dict[tuple[str, str], str] = {}
    for edge in sorted(request["edges"], key=lambda item: item["id"]):
        pairs = [(edge["from"], edge["to"])]
        if edge["direction"] == "UNDIRECTED":
            pairs.append((edge["to"], edge["from"]))
        for source, target in pairs:
            graph.add_edge(source, target)
            key = (source, target)
            edge_ids[key] = min(edge_ids.get(key, edge["id"]), edge["id"])

    root = request["root"]
    graph.add_node(root)
    max_nodes = request["max_nodes"]
    bfs = nx.bfs_edges(
        graph,
        root,
        depth_limit=request["max_depth"],
        sort_neighbors=sorted,
    )
    visited = [root]
    traversed: list[str] = []
    for source, target in bfs:
        if len(visited) >= max_nodes:
            break
        visited.append(target)
        traversed.append(edge_ids[(source, target)])

    json.dump({"visitedNodeIds": visited, "traversedEdgeIds": traversed}, sys.stdout)


if __name__ == "__main__":
    main()
