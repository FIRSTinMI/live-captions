export function transform(str: string, transformations: { regex: RegExp, replacement: string }[]) {
    for (let t of transformations) {
        str = str.replace(t.regex, t.replacement)
    }

    return str;
}
