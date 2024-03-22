const transformations = [
    {
        regex: /(fucking?|bucking) gears/gmi,
        replacement: "Buc'n'Gears"
    },
    {
        regex: /zoo buttocks/gmi,
        replacement: "ZooBOTix"
    },
    {
        regex: /tea and tea/gmi,
        replacement: "TnT"
    },
    {
        regex: /blue (lines|lions)/gmi,
        replacement: "Blue Alliance"
    },
    {
        regex: /red (lines|lions)/gmi,
        replacement: "The Red Alliance"
    },
    {
        regex: /christian (go|know)/gmi,
        replacement: "Crescendo"
    },
    {
        regex: /the bears/gmi,
        replacement: "Da Bears"
    }
]

export function transform(str: string) {
    for (let t of transformations) {
        str = str.replace(t.regex, t.replacement)
    }

    return str;
}