let scene: THREE.Scene;
let logInterpreter: LogInterpreter;
let logFile = "dolphin 4.log";

function alertError(str: string) {
    debugger;
    alert(str);
}

function assert(condition: boolean, errorString: string) {
    if(!condition) {
        alert(errorString);
    }
}

window.onerror = function(event) {
    alertError(event.toString());
};

function getFirstCaptureGroup(regex: RegExp, str: string) : string {
    const regexResult = regex.exec(str);
    if(regexResult !== null) {
        return regexResult[1];
    } else {
        alertError("No regex results!");
        return "";
    }
}

function extractSemicolonSeparatedNumbers(regex: RegExp, str: string, expectInts: boolean) : number[] {
    const numStrings = getFirstCaptureGroup(regex, str).trim().split(';');

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

function chunkContainingPosition(pos: Position, chunkSize: number) {
    return new Position(
        Math.floor(pos.x / chunkSize),
        Math.floor(pos.y / chunkSize),
        Math.floor(pos.z / chunkSize)
    );
}

function toBoolean(str: string, trueString : string, falseString : string) : boolean {
    if(str === trueString) {
        return true;
    } else if(str === falseString) {
        return false;
    } else {
        alertError("Unexpected string!");
        return false;
    }
}

beginLoadingLog();
//createScene();

function beginLoadingLog() {
    fetch(logFile)
    .then(response => response.text()).then(function(text) {
        logInterpreter = new LogInterpreter(text);
        logInterpreter.interpretLog();
    });
}

class Position {
    public x: number;
    public y: number;
    public z: number;

    constructor(x: number, y: number, z: number) {
        this.x = x;
        this.y = y;
        this.z = z;
    }

    public static fromArray(vals: number[]) {
        assert(vals.length === 3, "Incorrect position array length.");
        return new Position(vals[0], vals[1], vals[2]);
    }

    public equals(other: Position) {
        return this.x === other.x 
            && this.y === other.y
            && this.z === other.z;
    }
}

enum Action {
    SHARP_TURN_LEFT,
    SOFT_TURN_LEFT,
    FORWARD,
    SOFT_TURN_RIGHT,
    SHARP_TURN_RIGHT,
  
    BOOST_AND_SHARP_TURN_LEFT,
    BOOST_AND_SOFT_TURN_LEFT,
    BOOST_AND_FORWARD,
    BOOST_AND_SOFT_TURN_RIGHT,
    BOOST_AND_SHARP_TURN_RIGHT,
  
    DRIFT_AND_SHARP_TURN_LEFT,
    DRIFT_AND_SHARP_TURN_RIGHT,
    
    ACTION_COUNT
}

function actionStringToAction(actionString : string) : Action {
    switch(actionString) {
        case "Sharp turn left": return Action.SHARP_TURN_LEFT;
        case "Soft turn left": return Action.SOFT_TURN_LEFT;
        case "Forward": return Action.FORWARD;
        case "Soft turn right": return Action.SOFT_TURN_RIGHT;
        case "Sharp turn right": return Action.SHARP_TURN_RIGHT;
        case "Boost+Sharp turn left": return Action.BOOST_AND_SHARP_TURN_LEFT;
        case "Boost+Soft turn left": return Action.BOOST_AND_SOFT_TURN_LEFT;
        case "Boost+Forward": return Action.BOOST_AND_FORWARD;
        case "Boost+Soft turn right": return Action.BOOST_AND_SOFT_TURN_RIGHT;
        case "Boost+Sharp turn right": return Action.BOOST_AND_SHARP_TURN_RIGHT;
        case "Drift left": return Action.DRIFT_AND_SHARP_TURN_LEFT;
        case "Drift right": return Action.DRIFT_AND_SHARP_TURN_RIGHT;
        default: 
            alertError("Invalid action string!"); 
            return -1;
    }
}

class QTableUpdate {
    public updatedStateChunkPosition!: Position;
    public updatedStateVehicleGoingRightWay!: boolean;
    public actionIndex!: number;
    public newValue!: number;
}

class AIFrame {
    public vehiclePos!: Position;
    public vehicleGoingRightDirection!: boolean;
    public qTableUpdate!: QTableUpdate | null;
    public actionTaken!: number;
    public bestActionTaken!: boolean;
}

class AISkips {
    public skipBecauseCrash: boolean;
    public skipCount: number;

    constructor(skipBecauseCrash: boolean) {
        this.skipBecauseCrash = skipBecauseCrash;
        this.skipCount = 0;
    }
}

class Lap {
    public endFrame: number;
    public timeMillis: number;

    constructor(endFrame: number, timeMillis: number) {
        this.endFrame = endFrame;
        this.timeMillis = timeMillis;
    }
}

class AIHistoryLog {
    private log: (AIFrame | AISkips)[];
    private deathIndices: number[];
    public laps: Lap[];

    private qTableSoFar: QTable;
    private chunkSize: number;
    
    constructor(chunkSize: number) {
        this.log = [];
        this.deathIndices = [];
        this.laps = [];

        this.qTableSoFar = new QTable();
        this.chunkSize = chunkSize;
    }

    public get topLogIndex() : number { return this.log.length - 1; }
    public get deathCount() : number { return this.deathIndices.length; }

    public addDeathFrame(index: number) {
        this.deathIndices.push(index);
    }

    public addLogEntry(entry: AIFrame | AISkips) {
        this.applyLogEntryToQTable(entry, this.qTableSoFar);
        this.log.push(entry);
    }

    public getValueInQTableSoFar(chunkPos: Position, rightWay: boolean, actionIndex: number) {
        return this.qTableSoFar.getChunk(chunkPos).getValue(rightWay, actionIndex);
    }

    public constructQTableAsOfNow() : QTable {
        return this.constructQTableAtHistoryStep(this.topLogIndex);
    }

    public constructQTableAtHistoryStep(step: number) : QTable {
        if(step === this.topLogIndex) {
            return this.qTableSoFar;
        } else {       
            const qTable = new QTable();
            for(let i = 0; i <= step; i++) {
                this.applyLogEntryToQTable(this.log[i], qTable);
            }
            return qTable;
        }
    }

    private applyLogEntryToQTable(entry: AIFrame | AISkips, qTable: QTable) {
        if (entry instanceof AIFrame) {
            if(entry.qTableUpdate !== null) {
                const tableUpdate = entry.qTableUpdate;
                const chunk = qTable.getChunk(tableUpdate.updatedStateChunkPosition);
                chunk.setValue(tableUpdate.updatedStateVehicleGoingRightWay, tableUpdate.actionIndex, tableUpdate.newValue);
            }

            // The C++ code creates a chunk even if it just reads the user's position,
            // so in any cases where a chunk was read but never updated we need to add
            // extra chunks. 
            qTable.makeEmptyChunkIfOneDoesntExist(chunkContainingPosition(entry.vehiclePos, this.chunkSize));
        }
    }

    public constructUserPath() : Position[] {
        const positions = [];
        for(const entry of this.log) {
            if(entry instanceof AIFrame) {
                positions.push(entry.vehiclePos);
            }
        }
        return positions;
    }
}

class ChunkStates {
    private rightDirVals : number[];
    private wrongDirVals : number[];

    constructor() {
        this.rightDirVals = Array(Action.ACTION_COUNT).fill(0);
        this.wrongDirVals = Array(Action.ACTION_COUNT).fill(0);
    }

    public setValue(rightDir: boolean, actionIndex: number, value: number) {
        const vals = rightDir ? this.rightDirVals : this.wrongDirVals;

        assert(actionIndex >= 0 && actionIndex < vals.length, "Invalid action index.");
        vals[actionIndex] = value;
    }

    public getValue(rightDir: boolean, actionIndex: number) {
        const vals = rightDir ? this.rightDirVals : this.wrongDirVals;

        assert(actionIndex >= 0 && actionIndex < vals.length, "Invalid action index.");
        return vals[actionIndex];
    }

    public get valuesPerDirection() : number { return this.rightDirVals.length; }
}

class QTable {
    private chunks: ChunkStates[][][];
    private _chunkCount: number;

    constructor() {
        this.chunks = [];
        this._chunkCount = 0;
    }

    public get chunkCount() { return this._chunkCount; }

    public chunkHasValues(pos: Position) : boolean {
        const x = pos.x;
        const y = pos.y;
        const z = pos.z;

        if(!(x in this.chunks)) {
            return false;
        }
        if(!(y in this.chunks[x])) {
            return false;
        }
        if(!(z in this.chunks[x][y])) {
            return false;
        }
        return true;
    }

    public makeEmptyChunkIfOneDoesntExist(pos: Position) {
        this.getChunk(pos);
    }

    public getChunk(pos: Position) : ChunkStates {
        const x = pos.x;
        const y = pos.y;
        const z = pos.z;

        if(!(x in this.chunks)) {
            this.chunks[x] = [];
        }
        if(!(y in this.chunks[x])) {
            this.chunks[x][y] = [];
        }
        if(!(z in this.chunks[x][y])) {
            this._chunkCount++;
            this.chunks[x][y][z] = new ChunkStates();
        }
        return this.chunks[x][y][z];
    }
}

class SessionInfo {
    public chunkSize: number = -1;
    public hoursToNoExploration: number = -1;
    public learningRate: number = -1;
    public discountRate: number = -1;
}

class LogInterpreter {

    private logLines: string[];
    private currentLineIndex: number;

    private totalCrashSkips = 0;
    private totalOtherSkips = 0;
    private totalLearn = 0;
    private totalNoLearn = 0;

    constructor(logText: string) {
        this.logLines = logText.split('\n');
        this.currentLineIndex = 0;
    }

    private get currentLine() : string { return this.logLines[this.currentLineIndex]; }

    private moveToNextLine() {
        if(this.currentLineIndex % 100000 === 0) {
            console.log(`${this.currentLineIndex} lines read`);
        }
        this.currentLineIndex++; 
    }

    // We need the -1 so that the trailing newline doesn't count as a line
    private get reachedEndOfLog() : boolean { return this.currentLineIndex >= (this.logLines.length - 1); }
    
    public interpretLog() {
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
                    historyLog.addDeathFrame(historyLog.topLogIndex);
                    this.moveToNextLine();
                    break;
                case "SKIP":
                    historyLog.addLogEntry(this.readSkips());
                    break;
                case "LAP":
                    const split = this.currentLine.split(' ');
                    historyLog.laps.push(new Lap(historyLog.topLogIndex, parseInt(split[3])));
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
        console.log('Laps:');
        console.log(historyLog.laps.map(l=>l.timeMillis).join(";"));
    }

    private readLogHeader() : SessionInfo {
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
                alertError("Error parsing header!");
            }

            this.moveToNextLine();
        }
        this.moveToNextLine();
        return info;
    }

    private readSkips() : AISkips {
        const skips = new AISkips(this.currentLine.includes("crash"));

        while(this.currentLine.startsWith("> SKIP")) {
            if(skips.skipBecauseCrash !== this.currentLine.includes("crash")) {
                break;
            }
            skips.skipCount++;

            if(skips.skipBecauseCrash) {
                this.totalCrashSkips++;
                this.expectCountsToEqual(this.totalCrashSkips, this.currentLine);
            } else {
                this.totalOtherSkips++;
                this.expectCountsToEqual(this.totalOtherSkips, this.currentLine);
            }

            this.moveToNextLine();
        }
        return skips;
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

        aiFrame.actionTaken = actionStringToAction(getFirstCaptureGroup(/\[(.*?)\]/, actLine));
        aiFrame.bestActionTaken = toBoolean(actLine.split(' ')[2], "BEST", "RAND");

        this.moveToNextLine();

        return aiFrame;
    }

    private readLocLine(aiFrame: AIFrame, sessionInfo: SessionInfo) {
        const locLine = this.currentLine;

        aiFrame.vehiclePos = Position.fromArray(extractSemicolonSeparatedNumbers(/P\((.*?)\)/, locLine, false));
        aiFrame.vehicleGoingRightDirection = toBoolean(locLine.split(' ')[4].trim(), "RIGHT", "WRONG");
        const trueChunkPos = Position.fromArray(extractSemicolonSeparatedNumbers(/C\((.*?)\)/, locLine, true));
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
            toBoolean(getFirstCaptureGroup(/@(.)/, learnLine), "R", "W");
        qTableUpdate.updatedStateChunkPosition =
            Position.fromArray(extractSemicolonSeparatedNumbers(/@.\((.*?)\)/, learnLine, true));
        qTableUpdate.actionIndex = actionStringToAction(getFirstCaptureGroup(/A\[(.*?)\]/, learnLine));
        const newQTableVal = parseFloat(getFirstCaptureGroup(/n=(.*?) /, learnLine));

        const oldQTableVal = parseFloat(getFirstCaptureGroup(/o=(.*?) /, learnLine));
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
        this.expectIncludesStringAndValueEquals("can't access info", this.totalOtherSkips);
        this.expectIncludesStringAndValueEquals("death", this.totalCrashSkips);
        this.expectIncludesStringAndValueEquals("don't learn", this.totalNoLearn);
        this.expectIncludesStringAndValueEquals("Restore", historyLog.deathCount);
        this.expectIncludesStringAndValueEquals("Chunk", qTableSoFar.chunkCount);
        this.expectIncludesStringAndValueEquals("State", qTableSoFar.chunkCount * 2);

        assert(this.currentLine.includes("Lap times"), "Expecting lap times!");

        let lapTimes: number[];
        if(this.currentLine.search(/[0-9]/) === -1) {
            lapTimes = [];
        } else {
            lapTimes = extractSemicolonSeparatedNumbers(/: (.*)/, this.currentLine, true);
        }
        assert(lapTimes.length === historyLog.laps.length, "Lap count off!");

        for(let i = 0; i < lapTimes.length; i++) {
            assert(lapTimes[i] === historyLog.laps[i].timeMillis, "Lap times incorrect!");
        }
        this.moveToNextLine();

        assert(this.currentLine.includes("Q TABLE"), "Expecting end of summary info!");
        this.moveToNextLine();

        while(!this.currentLine.includes("END STATE")) {
            const chunkCoord = Position.fromArray(extractSemicolonSeparatedNumbers(/\((.*?)\)/, this.currentLine, true));
            const rightWayQValues = extractSemicolonSeparatedNumbers(/R{(.*?)}/, this.currentLine, false);
            const wrongWayQValues = extractSemicolonSeparatedNumbers(/W{(.*?)}/, this.currentLine, false);

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

    private expectIncludesStringAndValueEquals(includedStr: string, expectedValue: number) {
        assert(this.currentLine.includes(includedStr), "Expected string not present.");

        const val = parseInt(getFirstCaptureGroup(/: (.*)/, this.currentLine).trim());
        assert(val === expectedValue, "Incorrect calculated value.");
        this.moveToNextLine();
    }

    private expectCountsToEqual(calculatedCt: number, stringContainingCount: string) {
        const expectedCount = parseInt(getFirstCaptureGroup(/ct=(.*?)\)/, stringContainingCount));
        assert(calculatedCt === expectedCount, "Count mismatch.");
    }
}

// function createScene() {
//     scene = new THREE.Scene();
//     let camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
//     let controls = new THREE.OrbitControls( camera );

//     let renderer = new THREE.WebGLRenderer();
//     renderer.setPixelRatio(window.devicePixelRatio);
//     renderer.setSize(window.innerWidth, window.innerHeight);
//     document.body.appendChild(renderer.domElement);

//     camera.position.z = 100;
//     controls.update();

//     function animate() {
//         requestAnimationFrame( animate );
//         controls.update();
//     //     cube.rotation.x += 0.01;
//     //     cube.rotation.y += 0.01;
//         renderer.render( scene, camera );
//     }
//     animate();
// }
