class AbstractLogParser {
    protected logLines: string[];
    protected currentLineIndex: number;

    constructor(logText: string) {
        this.logLines = logText.split('\n');
        this.currentLineIndex = 0;
    }

    protected get currentLine() : string { return this.logLines[this.currentLineIndex]; }

    protected moveToNextLine() {
        if(this.currentLineIndex % 100000 === 0) {
            console.log(`${this.currentLineIndex} lines read`);
        }
        this.currentLineIndex++; 
    }

    // We need the -1 so that the trailing newline doesn't count as a line
    protected get reachedEndOfLog() : boolean { return this.currentLineIndex >= (this.logLines.length - 1); }

    protected readLogHeader() : SessionInfo {
        const info: SessionInfo = new SessionInfo();

        while(!this.currentLine.includes("END AI ENABLED SECTION")) {
            if(this.currentLine.includes("AI ENABLED")) {
                this.moveToNextLine();
            }

            const parts = this.currentLine.split(':');
            const val = parseFloat(parts[1]);
            if(parts[0].startsWith("Chunk")) {
                info.chunkSize = val;
            } else if(parts[0].startsWith("Hours")) {
                info.hoursToNoExploration = val;
            } else if(parts[0].startsWith("Learning")) {
                info.learningRate = val;
            } else if(parts[0].startsWith("Discount")) {
                info.discountRate = val;
            } else {
                //alertError("Error parsing header!");
            }

            this.moveToNextLine();
        }
        this.moveToNextLine();
        return info;
    }

    // UTILITY METHODS
    protected expectIncludesStringAndValueEquals(includedStr: string, expectedValue: number) {
        assert(this.currentLine.includes(includedStr), "Expected string not present.");

        const val = parseInt(this.getFirstCaptureGroup(/: (.*)/, this.currentLine).trim());
        assert(val === expectedValue, "Incorrect calculated value.");
        this.moveToNextLine();
    }

    protected expectCountsToEqual(calculatedCt: number, stringContainingCount: string) {
        const expectedCount = parseInt(this.getFirstCaptureGroup(/ct=(.*?)\)/, stringContainingCount));
        assert(calculatedCt === expectedCount, "Count mismatch.");
    }

    protected getFirstCaptureGroup(regex: RegExp, str: string) : string {
        const regexResult = regex.exec(str);
        if(regexResult !== null) {
            return regexResult[1];
        } else {
            alertError("No regex results!");
            return "";
        }
    }
    
    protected extractSemicolonSeparatedNumbers(regex: RegExp, str: string, expectInts: boolean) : number[] {
        const numStrings = this.getFirstCaptureGroup(regex, str).trim().split(';');
    
        // Remove trailing comma if it exists.
        if(numStrings[numStrings.length-1] === "") {
            numStrings.pop();
        }
    
        if(expectInts) {
            return numStrings.map(s=>parseInt(s.replace(',','')));
        } else {
            return numStrings.map(s=>parseFloat(s.replace(',','')));
        }
    
    }
    
    protected toBoolean(str: string, trueString : string, falseString : string) : boolean {
        if(str === trueString) {
            return true;
        } else if(str === falseString) {
            return false;
        } else {
            alertError("Unexpected string!");
            return false;
        }
    }
}