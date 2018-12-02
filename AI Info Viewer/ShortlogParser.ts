class SLLap {
    public endTime: number;
    public explorationRate: number;
    public lengthMillis: number;

    constructor(endTime: number, explorationRate: number, lengthMillis: number) {
        this.endTime = endTime; 
        this.explorationRate = explorationRate; 
        this.lengthMillis = lengthMillis; 
    }
}

class SLDeath {
    public time: number;
    public explorationRate: number;

    constructor(time: number, explorationRate: number) {
        this.time = time; 
        this.explorationRate = explorationRate;
    }
}

class ShortlogParser extends AbstractLogParser {

    public parse() : [SessionInfo, SLLap[], SLDeath[]] {
        const millisStart = Date.now();

        const sessionInfo = this.readLogHeader();

        const deaths : SLDeath[] = [];
        const laps : SLLap[] = [];

        while(!this.reachedEndOfLog) {
            if(!this.currentLine.startsWith('t=')) {
                this.moveToNextLine();
                //this.readState();
            } else {
                const parts = this.currentLine.split(' ');
                const time = parseInt(parts[0].split('=')[1]);
                const explorationRate = parseFloat(parts[1].split('=')[1]);
                if (parts[2] === "DEATH") {
                    deaths.push(new SLDeath(time, explorationRate));
                } else if (parts[2] === "LAP") {
                    laps.push(new SLLap(time, explorationRate, parseInt(parts[4])));
                } else {
                    alertError("Unexpected shortlog line");
                }
                this.moveToNextLine();
            }
        }
        const millisEnd = Date.now();
        console.log(`Read ~${this.currentLineIndex} lines in ${(millisEnd-millisStart)/1000.0}seconds`);

        return [sessionInfo, laps, deaths];
    }

    // private readState() {
    //     assert(this.currentLine.includes("BEGIN STATE"), "Unexpected start of state!");
    //     this.moveToNextLine();

    //     assert(this.currentLine.includes("SUMMARY INFO"), "Unexpected start of state!");
    //     this.moveToNextLine();

    //     const qTableSoFar = historyLog.constructQTableAsOfNow();

    //     this.expectIncludesStringAndValueEquals("total learning", this.totalLearn);
    //     this.expectIncludesStringAndValueEquals("lost", this.totalLostFrames);
    //     this.expectIncludesStringAndValueEquals("death", this.totalCrashFrames);
    //     this.expectIncludesStringAndValueEquals("don't learn", this.totalNoLearn);
    //     this.expectIncludesStringAndValueEquals("total", historyLog.getTotalFramesSoFar());
    //     this.expectIncludesStringAndValueEquals("Restore", historyLog.deathCount);
    //     this.expectIncludesStringAndValueEquals("Chunk", qTableSoFar.chunkCount);
    //     this.expectIncludesStringAndValueEquals("State", qTableSoFar.chunkCount * 2);

    //     assert(this.currentLine.includes("Lap times"), "Expecting lap times!");

    //     let lapTimes: number[];
    //     if(this.currentLine.search(/[0-9]/) === -1) {
    //         lapTimes = [];
    //     } else {
    //         lapTimes = this.extractSemicolonSeparatedNumbers(/: (.*)/, this.currentLine, true);
    //     }
    //     assert(lapTimes.length === historyLog.laps.length, "Lap count off!");

    //     for(let i = 0; i < lapTimes.length; i++) {
    //         assert(lapTimes[i] === historyLog.laps[i].timeMillis, "Lap times incorrect!");
    //     }
    //     this.moveToNextLine();

    //     assert(this.currentLine.includes("Q TABLE"), "Expecting end of summary info!");
    //     this.moveToNextLine();

    //     while(!this.currentLine.includes("END STATE")) {
    //         const chunkCoord = AIPosition.fromArray(this.extractSemicolonSeparatedNumbers(/\((.*?)\)/, this.currentLine, true));
    //         const rightWayQValues = this.extractSemicolonSeparatedNumbers(/R{(.*?)}/, this.currentLine, false);
    //         const wrongWayQValues = this.extractSemicolonSeparatedNumbers(/W{(.*?)}/, this.currentLine, false);

    //         assert(rightWayQValues.length === wrongWayQValues.length, "Something went wrong reading the q-values.");
    //         assert(qTableSoFar.chunkHasValues(chunkCoord), "Calculated Q table is missing chunks.");
    //         assert(rightWayQValues.length === Action.ACTION_COUNT, "Action enum has wrong number of actions.");

    //         const calculatedValues = qTableSoFar.getChunk(chunkCoord);
    //         assert(calculatedValues.valuesPerDirection === rightWayQValues.length, "Q-value arrays are incorrect size!");

    //         for(let i = 0; i < Action.ACTION_COUNT; i++) {
    //             assert(calculatedValues.getValue(true, i) === rightWayQValues[i], "Incorrect calculated q-values!");
    //             assert(calculatedValues.getValue(false, i) === wrongWayQValues[i], "Incorrect calculated q-values!");
    //         }

    //         this.moveToNextLine();
    //     }
    //     this.moveToNextLine();
    // }
}