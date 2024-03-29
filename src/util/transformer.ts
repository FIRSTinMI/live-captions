const transformations = [
    {
        regex: /(\d\d)(\.| )(\d\d)/gm,
        replacement: "$1$3"
    },
    {
        regex: /(fucking?|bucking|bucket) gears/gmi,
        replacement: "Buc'n'Gears"
    },
    {
        regex: /(zoo buttocks|zubats)/gmi,
        replacement: "ZooBOTix"
    },
    {
        regex: /tea and tea/gmi,
        replacement: "TnT"
    },
    {
        regex: /blue (lines?|lions?)/gmi,
        replacement: "Blue Alliance"
    },
    {
        regex: /red (lines?|lions?)/gmi,
        replacement: "Red Alliance"
    },
    {
        regex: /christian (go|know)/gmi,
        replacement: "Crescendo"
    },
    {
        regex: /the bears/gmi,
        replacement: "Da Bears"
    },
    {
        regex: /try sonic's/gmi,
        replacement: "TriSonics"
    },
    {
        regex: /soccer tr?uck/gmi,
        replacement: "Saugatuck"
    },
    {
        regex: /so (i've|i) (been|can) driving/gmi,
        replacement: "step up and drive"
    },
    {
        regex: /drivers? behind a lines?/gmi,
        replacement: 'drivers behind the lines'
    },
    {
        regex: /drunk town thunder/gmi,
        replacement: "Truck Town Thunder"
    },
    {
        regex: /rubble eagles/gmi,
        replacement: "RoboEagles"
    },
    {
        regex: /bender butts/gmi,
        replacement: "Vander Bots"
    }
]

export function transform(str: string) {
    for (let t of transformations) {
        str = str.replace(t.regex, t.replacement)
    }

    return str;
}
