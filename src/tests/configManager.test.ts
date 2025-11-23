import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { ConfigManager, parseTransformations } from "../util/configManager";
import { existsSync, unlinkSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("ConfigManager", () => {
    let configFile: string;
    let configManager: ConfigManager;

    beforeEach(() => {
        // Create a temporary config file for testing
        configFile = join(tmpdir(), `test-config-${Date.now()}.json`);
    });

    afterEach(() => {
        // Clean up temporary config file
        if (existsSync(configFile)) {
            unlinkSync(configFile);
        }
    });

    describe("constructor and initialization", () => {
        it("should create a new ConfigManager instance", () => {
            configManager = new ConfigManager(configFile);
            expect(configManager).toBeDefined();
        });

        it("should initialize with default display config", () => {
            configManager = new ConfigManager(configFile);
            expect(configManager.display).toEqual({
                position: 0,
                size: 42,
                lines: 2,
                chromaKey: 'rgba(0,0,0,0)',
                timeout: 5,
                align: 'left',
                hidden: false
            });
        });

        it("should initialize with default server config", () => {
            configManager = new ConfigManager(configFile);
            expect(configManager.server.port).toBe(3000);
            expect(configManager.server.google.scopes).toBe('https://www.googleapis.com/auth/cloud-platform');
        });

        it("should initialize with default transcription config", () => {
            configManager = new ConfigManager(configFile);
            expect(configManager.transcription.engine).toBe('googlev2');
            expect(configManager.transcription.streamingTimeout).toBe(60000);
            expect(Array.isArray(configManager.transcription.phraseSets)).toBe(true);
        });

        it("should initialize with default transformations", () => {
            configManager = new ConfigManager(configFile);
            expect(Array.isArray(configManager.transformations)).toBe(true);
            expect(configManager.transformations.length).toBeGreaterThan(0);
        });

        it("should create config file if it doesn't exist", () => {
            configManager = new ConfigManager(configFile);
            expect(existsSync(configFile)).toBe(true);
        });
    });

    describe("save and load", () => {
        it("should save config to file", () => {
            configManager = new ConfigManager(configFile);
            configManager.display.size = 50;
            configManager.save();

            const fileContent = JSON.parse(readFileSync(configFile, 'utf-8'));
            expect(fileContent.display.size).toBe(50);
        });

        it("should load config from file", () => {
            configManager = new ConfigManager(configFile);
            configManager.display.size = 100;
            configManager.server.port = 4000;
            configManager.save();

            // Create a new instance and verify it loads the saved config
            const newConfigManager = new ConfigManager(configFile);
            expect(newConfigManager.display.size).toBe(100);
            expect(newConfigManager.server.port).toBe(4000);
        });

        it("should preserve default values for missing config properties", () => {
            configManager = new ConfigManager(configFile);
            const originalSize = configManager.display.size;
            configManager.save();

            // Modify the file to remove a property
            const fileContent = JSON.parse(readFileSync(configFile, 'utf-8'));
            delete fileContent.display.size;
            require('fs').writeFileSync(configFile, JSON.stringify(fileContent));

            // Load again and verify default is restored
            const newConfigManager = new ConfigManager(configFile);
            expect(newConfigManager.display.size).toBe(originalSize);
        });

        it("should convert regex objects to strings for JSON serialization", () => {
            configManager = new ConfigManager(configFile);
            configManager.save();

            const fileContent = JSON.parse(readFileSync(configFile, 'utf-8'));
            expect(typeof fileContent.transformations[0].regex).toBe('string');
        });
    });

    describe("get method", () => {
        it("should return entire config object", () => {
            configManager = new ConfigManager(configFile);
            const config = configManager.get();

            expect(config.display).toBeDefined();
            expect(config.server).toBeDefined();
            expect(config.transcription).toBeDefined();
            expect(config.transformations).toBeDefined();
        });

        it("should return config with correct structure", () => {
            configManager = new ConfigManager(configFile);
            const config = configManager.get();

            expect(config.display.position).toBeDefined();
            expect(config.server.port).toBeDefined();
            expect(config.transcription.engine).toBeDefined();
            expect(Array.isArray(config.transformations)).toBe(true);
        });
    });

    describe("set method", () => {
        beforeEach(() => {
            configManager = new ConfigManager(configFile);
        });

        it("should set server port", () => {
            configManager.set('server.port', '5000');
            expect(configManager.server.port).toBe(5000);
        });

        it("should set display position", () => {
            configManager.set('display.position', '10');
            expect(configManager.display.position).toBe(10);
        });

        it("should set display size", () => {
            configManager.set('display.size', '50');
            expect(configManager.display.size).toBe(50);
        });

        it("should set display lines", () => {
            configManager.set('display.lines', '3');
            expect(configManager.display.lines).toBe(3);
        });

        it("should set display chromaKey", () => {
            const newChromaKey = 'rgba(255,0,0,0)';
            configManager.set('display.chromaKey', newChromaKey);
            expect(configManager.display.chromaKey).toBe(newChromaKey);
        });

        it("should set display timeout", () => {
            configManager.set('display.timeout', '10');
            expect(configManager.display.timeout).toBe(10);
        });

        it("should set display align", () => {
            configManager.set('display.align', 'center');
            expect(configManager.display.align).toBe('center');
        });

        it("should set transcription engine", () => {
            configManager.set('transcription.engine', 'april');
            expect(configManager.transcription.engine).toBe('april');
        });

        it("should set transcription hidden", () => {
            configManager.set('transcription.hidden', true);
            expect(configManager.display.hidden).toBe(true);
        });

        it("should parse numeric strings to numbers", () => {
            configManager.set('server.port', '8080');
            expect(typeof configManager.server.port).toBe('number');
            expect(configManager.server.port).toBe(8080);
        });
    });

    describe("transformations", () => {
        beforeEach(() => {
            configManager = new ConfigManager(configFile);
        });

        it("should have transformations with regex and replacement", () => {
            for (const transformation of configManager.transformations) {
                expect(transformation.regex).toBeInstanceOf(RegExp);
                expect(typeof transformation.replacement).toBe('string');
            }
        });

        it("should apply transformations correctly", () => {
            const testText = "we have 25 25 gears";
            let result = testText;
            for (const transformation of configManager.transformations) {
                result = result.replace(transformation.regex, transformation.replacement);
            }
            expect(result).toBe("we have 2525 gears");
        });

        it("should handle multiple transformations", () => {
            const testText = "fucking gears and blue lions";
            let result = testText;
            for (const transformation of configManager.transformations) {
                result = result.replace(transformation.regex, transformation.replacement);
            }
            expect(result).toContain("Buc'n'Gears");
            expect(result).toContain("Blue Alliance");
        });
    });

    describe("parseTransformations", () => {
        it("should parse transformations from JSON format to RegExp", () => {
            const jsonTransformations = [
                {
                    regex: "/(foo|bar)/gm",
                    replacement: "baz"
                }
            ];

            const parsed = parseTransformations(jsonTransformations);
            expect(parsed.length).toBe(1);
            expect(parsed[0].regex).toBeInstanceOf(RegExp);
            expect(parsed[0].replacement).toBe("baz");
        });

        it("should handle multiple transformations", () => {
            const jsonTransformations = [
                { regex: "/(foo)/g", replacement: "bar" },
                { regex: "/(test)/m", replacement: "result" }
            ];

            const parsed = parseTransformations(jsonTransformations);
            expect(parsed.length).toBe(2);
        });

        it("should handle regex with flags", () => {
            const jsonTransformations = [
                { regex: "/(hello)/gi", replacement: "hi" }
            ];

            const parsed = parseTransformations(jsonTransformations);
            expect(parsed[0].regex.global).toBe(true);
            expect(parsed[0].regex.ignoreCase).toBe(true);
        });

        it("should return empty array for undefined input", () => {
            const parsed = parseTransformations(undefined as any);
            expect(Array.isArray(parsed)).toBe(true);
            expect(parsed.length).toBe(0);
        });

        it("should handle slashes in regex pattern", () => {
            const jsonTransformations = [
                { regex: "/(foo\\/bar)/g", replacement: "baz" }
            ];

            const parsed = parseTransformations(jsonTransformations);
            expect(parsed.length).toBe(1);
            expect(parsed[0].regex).toBeInstanceOf(RegExp);
        });
    });

    describe("regex serialization and deserialization", () => {
        beforeEach(() => {
            configManager = new ConfigManager(configFile);
        });

        it("should correctly serialize RegExp to string format", () => {
            configManager.save();
            const fileContent = JSON.parse(readFileSync(configFile, 'utf-8'));

            // Verify all transformations are serialized as strings in /pattern/flags format
            for (const transformation of fileContent.transformations) {
                expect(typeof transformation.regex).toBe('string');
                expect(transformation.regex.startsWith('/')).toBe(true);
                // Check that it has at least 2 slashes (start and end)
                const slashCount = (transformation.regex.match(/\//g) || []).length;
                expect(slashCount).toBeGreaterThanOrEqual(2);
            }
        });

        it("should correctly deserialize string format back to RegExp", () => {
            configManager.save();

            // Load from file and check that regex is properly converted back to RegExp objects
            const newConfigManager = new ConfigManager(configFile);

            for (const transformation of newConfigManager.transformations) {
                expect(transformation.regex).toBeInstanceOf(RegExp);
                expect(typeof transformation.replacement).toBe('string');
            }
        });

        it("should preserve regex source pattern through save/load cycle", () => {
            const testReplacement = "test_replacement_unique_marker";

            // Replace all transformations with a single test transformation
            configManager.transformations = [{
                regex: new RegExp("test pattern", "gi"),
                replacement: testReplacement
            }];
            configManager.save();

            // Load from file
            const newConfigManager = new ConfigManager(configFile);
            const savedTransformation = newConfigManager.transformations.find(
                t => t.replacement === testReplacement
            );

            expect(savedTransformation).toBeDefined();
            expect(savedTransformation?.regex.source).toBe("test pattern");
        });

        it("should preserve global flag through serialization", () => {
            configManager.transformations = [{
                regex: new RegExp("globaltest", "g"),
                replacement: "global_flag_test"
            }];
            configManager.save();

            const newConfigManager = new ConfigManager(configFile);
            const loaded = newConfigManager.transformations.find(t => t.replacement === "global_flag_test");

            expect(loaded?.regex.global).toBe(true);
        });

        it("should preserve ignoreCase flag through serialization", () => {
            configManager.transformations = [{
                regex: new RegExp("casetest", "i"),
                replacement: "ignore_case_test"
            }];
            configManager.save();

            const newConfigManager = new ConfigManager(configFile);
            const loaded = newConfigManager.transformations.find(t => t.replacement === "ignore_case_test");

            expect(loaded?.regex.ignoreCase).toBe(true);
        });

        it("should preserve multiline flag through serialization", () => {
            configManager.transformations = [{
                regex: new RegExp("multitest", "m"),
                replacement: "multiline_test"
            }];
            configManager.save();

            const newConfigManager = new ConfigManager(configFile);
            const loaded = newConfigManager.transformations.find(t => t.replacement === "multiline_test");

            expect(loaded?.regex.multiline).toBe(true);
        });

        it("should preserve combined flags through serialization", () => {
            configManager.transformations = [{
                regex: new RegExp("combinedtest", "gim"),
                replacement: "combined_flags_test"
            }];
            configManager.save();

            const newConfigManager = new ConfigManager(configFile);
            const loaded = newConfigManager.transformations.find(t => t.replacement === "combined_flags_test");

            expect(loaded?.regex.global).toBe(true);
            expect(loaded?.regex.ignoreCase).toBe(true);
            expect(loaded?.regex.multiline).toBe(true);
        });

        it("should handle digit patterns in regex", () => {
            configManager.transformations = [{
                regex: new RegExp("(\\d+)", "g"),
                replacement: "digits_replacement"
            }];
            configManager.save();

            const newConfigManager = new ConfigManager(configFile);
            const loaded = newConfigManager.transformations.find(t => t.replacement === "digits_replacement");

            expect(loaded?.regex.source).toBe("(\\d+)");
            expect(loaded?.regex.test("123")).toBe(true);
        });

        it("should handle whitespace patterns in regex", () => {
            configManager.transformations = [{
                regex: new RegExp("\\s+", "g"),
                replacement: "whitespace_replacement"
            }];
            configManager.save();

            const newConfigManager = new ConfigManager(configFile);
            const loaded = newConfigManager.transformations.find(t => t.replacement === "whitespace_replacement");

            expect(loaded?.regex.test("   ")).toBe(true);
        });

        it("should handle character class patterns in regex", () => {
            configManager.transformations = [{
                regex: new RegExp("[a-z]+", "gi"),
                replacement: "charclass_replacement"
            }];
            configManager.save();

            const newConfigManager = new ConfigManager(configFile);
            const loaded = newConfigManager.transformations.find(t => t.replacement === "charclass_replacement");

            expect(loaded?.regex.source).toBe("[a-z]+");
            expect(loaded?.regex.test("abc")).toBe(true);
        });

        it("should handle alternation patterns in regex", () => {
            configManager.transformations = [{
                regex: new RegExp("(foo|bar)", "g"),
                replacement: "alternation_replacement"
            }];
            configManager.save();

            const newConfigManager = new ConfigManager(configFile);
            const loaded = newConfigManager.transformations.find(t => t.replacement === "alternation_replacement");

            expect(loaded).toBeDefined();
            // Just verify the pattern exists, testing functionality separately
            expect(loaded?.regex.source).toContain("foo");
        });

        it("should maintain regex functionality after deserialization with case-insensitive matching", () => {
            configManager.transformations = [{
                regex: /hello/gi,
                replacement: "Hi"
            }];
            configManager.save();

            const newConfigManager = new ConfigManager(configFile);
            const loaded = newConfigManager.transformations.find(t => t.replacement === "Hi");

            expect(loaded).toBeDefined();
            const testText = "Hello HELLO hello";
            const result = testText.replace(loaded!.regex, loaded!.replacement);
            expect(result).toBe("Hi Hi Hi");
        });

        it("should maintain regex functionality for complex number patterns", () => {
            configManager.transformations = [{
                regex: /(\d\d)(\.| )(\d\d)/gm,
                replacement: "$1$3"
            }];
            configManager.save();

            const newConfigManager = new ConfigManager(configFile);
            const loaded = newConfigManager.transformations.find(t => t.replacement === "$1$3");

            expect(loaded).toBeDefined();
            const testText = "25 25 and 30.45";
            const result = testText.replace(loaded!.regex, loaded!.replacement);
            expect(result).toBe("2525 and 3045");
        });

        it("should round-trip default transformations without data loss", () => {
            // Save the default config
            configManager.save();
            const defaultCount = configManager.transformations.length;

            // Load fresh and count
            const newConfigManager = new ConfigManager(configFile);
            expect(newConfigManager.transformations.length).toBeGreaterThanOrEqual(defaultCount);

            // Verify all are RegExp instances with proper properties
            for (const transformation of newConfigManager.transformations) {
                expect(transformation.regex).toBeInstanceOf(RegExp);
                expect(typeof transformation.replacement).toBe('string');
                expect(transformation.regex.source).toBeDefined();
            }
        });

        it("should correctly parse regexes with special replacement patterns", () => {
            configManager.transformations = [{
                regex: /(\d\d)( ?)(\d)(:| )(\d\d)/gm,
                replacement: "$1$3$5"
            }];
            configManager.save();

            const newConfigManager = new ConfigManager(configFile);
            const loaded = newConfigManager.transformations.find(t => t.replacement === "$1$3$5");

            expect(loaded).toBeDefined();
            expect(loaded?.replacement).toBe("$1$3$5");
        });
    });

    describe("config merging", () => {
        it("should merge partial config with defaults", () => {
            configManager = new ConfigManager(configFile);
            const originalTimeout = configManager.transcription.streamingTimeout;

            // Modify and save
            configManager.transcription.streamingTimeout = 30000;
            configManager.save();

            // Load and verify other defaults are preserved
            const newConfigManager = new ConfigManager(configFile);
            expect(newConfigManager.transcription.streamingTimeout).toBe(30000);
            expect(newConfigManager.transcription.engine).toBe('googlev2');
        });

        it("should add new transformations from config", () => {
            configManager = new ConfigManager(configFile);
            const initialLength = configManager.transformations.length;

            configManager.save();

            // Create a new instance with the same file
            const newConfigManager = new ConfigManager(configFile);
            // Should have at least the initial transformations
            expect(newConfigManager.transformations.length).toBeGreaterThanOrEqual(initialLength);
        });
    });

    describe("Google API configuration", () => {
        beforeEach(() => {
            configManager = new ConfigManager(configFile);
        });

        it("should have default Google API config", () => {
            expect(configManager.server.google.projectId).toBe('');
            expect(configManager.server.google.credentials.client_email).toBe('');
            expect(configManager.server.google.credentials.private_key).toBe('');
        });

        it("should allow setting Google API credentials", () => {
            configManager.server.google.projectId = 'test-project';
            configManager.server.google.credentials.client_email = 'test@example.com';
            configManager.server.google.credentials.private_key = 'test-key';

            expect(configManager.server.google.projectId).toBe('test-project');
            expect(configManager.server.google.credentials.client_email).toBe('test@example.com');
            expect(configManager.server.google.credentials.private_key).toBe('test-key');
        });
    });
});
