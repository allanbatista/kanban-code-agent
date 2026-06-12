export function validateDag(nodes = []) {
  const errors = [];
  const provides = new Map();
  for (const node of nodes) {
    for (const contract of node.provides || []) {
      if (provides.has(contract)) errors.push({ type: "duplicate_provide", contract, nodes: [provides.get(contract), node.id] });
      else provides.set(contract, node.id);
    }
  }
  const edges = [];
  for (const node of nodes) {
    for (const contract of node.needs || []) {
      const from = provides.get(contract);
      if (!from) errors.push({ type: "missing_contract", contract, node: node.id });
      else edges.push({ from, to: node.id, contract });
    }
  }
  const graph = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) graph.get(edge.from)?.push(edge.to);
  const visiting = new Set();
  const visited = new Set();
  function visit(id, path = []) {
    if (visiting.has(id)) {
      errors.push({ type: "cycle", path: [...path, id] });
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const next of graph.get(id) || []) visit(next, [...path, id]);
    visiting.delete(id);
    visited.add(id);
  }
  for (const node of nodes) visit(node.id);
  return { ok: errors.length === 0, errors, edges };
}
