import re


def get_nested_prop(item, node):
    ptr = item
    for token in node["tokens"]:
        # check if token ends with [number]
        m = re.search("\[.*?\]", token)
        if m is not None:
            first, last = m.span()
            token = token[:first]
            if token in ptr:
                ptr = ptr[token]
                # address within array
                try:
                    value = int(m.group()[1:-1])
                    if isinstance(ptr, (list, tuple)):
                        ptr = ptr[value]
                    else:
                        return [False, None]
                except ValueError:
                    # should not happen
                    # token inludes [?] but ? is not a number
                    return [False, None]
        elif token in ptr:
            ptr = ptr[token]
        else:
            return [False, None]
    return [True, ptr]


def _eval(item, node):
    if node["type"] == "or":
        # any
        for arg in node["args"]:
            if _eval(item, arg):
                return True
        return False
    elif node["type"] == "and":
        # all
        return all([_eval(item, arg) for arg in node["args"]])
    elif node["type"] == "xor":
        # one
        return sum([_eval(item, arg) for arg in node["args"]]) == 1
    elif node["type"] == "not":
        return not _eval(item, node["arg"])
    elif node["type"] == "expr":
        ok, item_val = get_nested_prop(item, node)
        if ok:
            expr_val = node["value"]
            if isinstance(expr_val, str):
                expr_val = expr_val.lower()
                item_val = item_val.lower()

            if node["op"] == "eq":
                return item_val == expr_val
            elif node["op"] == "neq":
                return item_val != expr_val
            elif node["op"] == "lt":
                return item_val < expr_val
            elif node["op"] == "le":
                return item_val <= expr_val
            elif node["op"] == "gt":
                return item_val > expr_val
            elif node["op"] == "ge":
                return item_val >= expr_val
            elif node["op"] == "has":
                return True

            if isinstance(expr_val, str):
                if node["op"] == "in":
                    return expr_val in item_val
                elif node["op"] == "startswith":
                    return item_val.startswith(expr_val)
                elif node["op"] == "endswith":
                    return item_val.endswidth(expr_val)
                elif node["op"] == "regex":
                    return re.search(expr_val, item_val) is not None

    return False


def evaluate(item, expr):
    return _eval(item, expr)


if __name__ == "__main__":

    import json
    s = """
{
  "type": "and",
  "args": [
    {
      "type": "expr",
      "tokens": [
        "foo",
        "bar[0]"
      ],
      "op": "eq",
      "value": 1
    },
    {
      "type": "expr",
      "tokens": [
        "bos"
      ],
      "op": "eq",
      "value": 2
    }
  ]
}
    """
    expr = json.loads(s)
    item = {"foo": {"bar": [1, 2, 3]}, "bos": 2}
    print(evaluate(item, expr))

    item2 = {"foo": {"bar": 2}, "bos": 2}
    print(evaluate(item2, expr))
