class LogParser extends AbstractLogParser {

    private totalCrashFrames = 0;
    private totalLostFrames = 0;
    private totalLearn = 0;
    private totalNoLearn = 0;

    public parse() : AISession {
        const millisStart = Date.now();

        const sessionInfo = this.readLogHeader();
        const historyLog = new AIHistoryLog(sessionInfo.chunkSize);

        while(!this.reachedEndOfLog) {
            if(!this.currentLine.startsWith('>')) {
                this.readState(historyLog);
            }

            const lineType = this.currentLine.split(' ')[1];
            switch(lineType) {
                case "RESTORE":
                    historyLog.checkThatPreviousFrameWasRestore();
                    this.moveToNextLine();
                    break;
                case "SKIP":
                    const associatedWithDeath = !(historyLog.getLogEntry(historyLog.topLogIndex) instanceof AILostFrames
                        && historyLog.getLogEntry(historyLog.topLogIndex-1) instanceof AIRestoreFrames);

                    const restoreFrames = this.readRestoreFrames();
                    restoreFrames.associatedWithDeath = associatedWithDeath;
                    historyLog.addLogEntry(restoreFrames);
                    break;
                case "FRAMESLOST":
                    const entry = this.readFramesLost();
                    historyLog.addLogEntry(entry);
                    break;
                case "LAP":
                    const split = this.currentLine.split(' ');
                    historyLog.laps.push(new Lap(historyLog.getTotalFramesSoFar(), parseInt(split[3])));
                    const expectedLapNum = parseInt(split[2]);
                    assert(expectedLapNum === historyLog.laps.length-1, "Lap number mismatch.");
                    this.moveToNextLine();
                    break;
                case "LOC":
                    historyLog.addLogEntry(this.readLocLearnActTriplet(sessionInfo, historyLog));
                    break;
                case "LEARN":
                case "NOLEARN":
                case "ACT":
                    alertError("This line type should have been handled by LOC!");
                    break;
                default:
                    alertError("Unexpected line type!");
            }
        }
        const millisEnd = Date.now();
        console.log(`Read ~${this.currentLineIndex} lines in ${(millisEnd-millisStart)/1000.0}seconds`);
        sessionInfo.totalLearnFrames = this.totalLearn;
        sessionInfo.totalNoLearnFrames = this.totalNoLearn;
        sessionInfo.totalCrashFrames = this.totalCrashFrames;
        sessionInfo.totalLostFrames = this.totalLostFrames;

        return new AISession(sessionInfo, historyLog);
    }

    public justGetLaps(): Lap[] {
        const laps: Lap[] = [];
        while(!this.reachedEndOfLog) {
            const lineType = this.currentLine.split(' ')[1];
            if(lineType === "LAP") {
                const split = this.currentLine.split(' ');
                laps.push(new Lap(-1, parseInt(split[3])));
                const expectedLapNum = parseInt(split[2]);
                assert(expectedLapNum === laps.length-1, "Lap number mismatch.");
            }
            this.moveToNextLine();
        }

        return laps;
    }

    private readRestoreFrames() : AIRestoreFrames {
        const restoreFrames = new AIRestoreFrames(0, true);

        while(this.currentLine.startsWith("> SKIP")) {
            restoreFrames.frameCount++;
            this.totalCrashFrames++;
            this.expectCountsToEqual(this.totalCrashFrames, this.currentLine);
            this.moveToNextLine();
        }

        return restoreFrames;
    }

    private readFramesLost() {
        const splitFL = this.currentLine.split(' ');
        const lostFrameCount = parseInt(splitFL[splitFL.length - 2]);
        this.totalLostFrames += lostFrameCount;
        this.expectCountsToEqual(this.totalLostFrames, this.currentLine);
        this.moveToNextLine();
        const entry = new AILostFrames(lostFrameCount);
        return entry;
    }

    private readLocLearnActTriplet(sessionInfo : SessionInfo, historyLog: AIHistoryLog) : AIFrame {
        const aiFrame = new AIFrame();

        this.readLocLine(aiFrame, sessionInfo);

        if(this.currentLine.startsWith("> NOLEARN")) {
            this.totalNoLearn++;
            this.expectCountsToEqual(this.totalNoLearn, this.currentLine);
            aiFrame.qTableUpdate = null;
            this.moveToNextLine();
        } else if (this.currentLine.startsWith("> LEARN")) {
            this.readLearnLine(aiFrame, historyLog);
        } else {
            alertError("Expected learn line but there wasn't any!");
        }

        const actLine = this.currentLine;
        assert(actLine.startsWith("> ACT"), "Expected act line but there wasn't any!");

        aiFrame.actionTaken = actionStringToAction(this.getFirstCaptureGroup(/\[(.*?)\]/, actLine));
        aiFrame.bestActionTaken = this.toBoolean(actLine.split(' ')[2], "BEST", "RAND");

        this.moveToNextLine();

        return aiFrame;
    }

    private readLocLine(aiFrame: AIFrame, sessionInfo: SessionInfo) {
        const locLine = this.currentLine;

        aiFrame.vehiclePos = AIPosition.fromArray(this.extractSemicolonSeparatedNumbers(/P\((.*?)\)/, locLine, false));
        aiFrame.vehicleGoingRightDirection = this.toBoolean(locLine.split(' ')[4].trim(), "RIGHT", "WRONG");
        const trueChunkPos = AIPosition.fromArray(this.extractSemicolonSeparatedNumbers(/C\((.*?)\)/, locLine, true));
        const calculatedChunkPos = chunkContainingPosition(aiFrame.vehiclePos, sessionInfo.chunkSize);
        assert(trueChunkPos.equals(calculatedChunkPos), "Chunk sizes are being calculated incorrectly.");

        this.moveToNextLine();
    }

    private readLearnLine(aiFrame: AIFrame, historyLog: AIHistoryLog) {
        const learnLine = this.currentLine;

        this.totalLearn++;
        this.expectCountsToEqual(this.totalLearn, learnLine);
        const qTableUpdate = new QTableUpdate();
        qTableUpdate.updatedStateVehicleGoingRightWay =
            this.toBoolean(this.getFirstCaptureGroup(/@(.)/, learnLine), "R", "W");
        qTableUpdate.updatedStateChunkPosition =
            AIPosition.fromArray(this.extractSemicolonSeparatedNumbers(/@.\((.*?)\)/, learnLine, true));
        qTableUpdate.actionIndex = actionStringToAction(this.getFirstCaptureGroup(/A\[(.*?)\]/, learnLine));
        const newQTableVal = parseFloat(this.getFirstCaptureGroup(/n=(.*?) /, learnLine));

        const oldQTableVal = parseFloat(this.getFirstCaptureGroup(/o=(.*?) /, learnLine));
        const calculatedOldTableVal = historyLog.getValueInQTableSoFar(qTableUpdate.updatedStateChunkPosition,
            qTableUpdate.updatedStateVehicleGoingRightWay, qTableUpdate.actionIndex);

        assert(oldQTableVal === calculatedOldTableVal, "Error in Q table update logic!");

        qTableUpdate.newValue = newQTableVal;
        aiFrame.qTableUpdate = qTableUpdate;

        this.moveToNextLine();
    }

    private readState(historyLog: AIHistoryLog) {
        assert(this.currentLine.includes("BEGIN STATE"), "Unexpected start of state!");
        this.moveToNextLine();

        assert(this.currentLine.includes("SUMMARY INFO"), "Unexpected start of state!");
        this.moveToNextLine();

        const qTableSoFar = historyLog.constructQTableAsOfNow();

        this.expectIncludesStringAndValueEquals("total learning", this.totalLearn);
        this.expectIncludesStringAndValueEquals("lost", this.totalLostFrames);
        this.expectIncludesStringAndValueEquals("death", this.totalCrashFrames);
        this.expectIncludesStringAndValueEquals("don't learn", this.totalNoLearn);
        this.expectIncludesStringAndValueEquals("total", historyLog.getTotalFramesSoFar());
        this.expectIncludesStringAndValueEquals("Restore", historyLog.deathCount);
        this.expectIncludesStringAndValueEquals("Chunk", qTableSoFar.chunkCount);
        this.expectIncludesStringAndValueEquals("State", qTableSoFar.chunkCount * 2);

        assert(this.currentLine.includes("Lap times"), "Expecting lap times!");

        let lapTimes: number[];
        if(this.currentLine.search(/[0-9]/) === -1) {
            lapTimes = [];
        } else {
            lapTimes = this.extractSemicolonSeparatedNumbers(/: (.*)/, this.currentLine, true);
        }
        assert(lapTimes.length === historyLog.laps.length, "Lap count off!");

        for(let i = 0; i < lapTimes.length; i++) {
            assert(lapTimes[i] === historyLog.laps[i].timeMillis, "Lap times incorrect!");
        }
        this.moveToNextLine();

        assert(this.currentLine.includes("Q TABLE"), "Expecting end of summary info!");
        this.moveToNextLine();

        while(!this.currentLine.includes("END STATE")) {
            const chunkCoord = AIPosition.fromArray(this.extractSemicolonSeparatedNumbers(/\((.*?)\)/, this.currentLine, true));
            const rightWayQValues = this.extractSemicolonSeparatedNumbers(/R{(.*?)}/, this.currentLine, false);
            const wrongWayQValues = this.extractSemicolonSeparatedNumbers(/W{(.*?)}/, this.currentLine, false);

            assert(rightWayQValues.length === wrongWayQValues.length, "Something went wrong reading the q-values.");
            assert(qTableSoFar.chunkHasValues(chunkCoord), "Calculated Q table is missing chunks.");
            assert(rightWayQValues.length === Action.ACTION_COUNT, "Action enum has wrong number of actions.");

            const calculatedValues = qTableSoFar.getChunk(chunkCoord);
            assert(calculatedValues.valuesPerDirection === rightWayQValues.length, "Q-value arrays are incorrect size!");

            for(let i = 0; i < Action.ACTION_COUNT; i++) {
                assert(calculatedValues.getValue(true, i) === rightWayQValues[i], "Incorrect calculated q-values!");
                assert(calculatedValues.getValue(false, i) === wrongWayQValues[i], "Incorrect calculated q-values!");
            }

            this.moveToNextLine();
        }
        this.moveToNextLine();
    }
}