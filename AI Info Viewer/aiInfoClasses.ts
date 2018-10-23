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

function chunkContainingPosition(pos: Position, chunkSize: number) {
    return new Position(
        Math.floor(pos.x / chunkSize),
        Math.floor(pos.y / chunkSize),
        Math.floor(pos.z / chunkSize)
    );
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

class AIRestoreFrames {
    public frameCount: number;

    constructor() {
        this.frameCount = 0;
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

class PathHistorySegmentDeath {
    public restoreFrames: number;

    constructor(restoreFrames: number) {
        this.restoreFrames = restoreFrames;
    }
 }

class PathSegment {
     public path: (Position | PathHistorySegmentDeath)[];

     public get totalFrames() : number {
         let sum = 0;
         for(const elem of this.path) {
             if(elem instanceof Position) {
                sum++;
             } else {
                 sum += elem.restoreFrames;
             }
         }
         return sum;     }

     constructor() {
         this.path = [];
     }
}

class AIHistoryLog {
    private log: (AIFrame | AIRestoreFrames)[];
    public laps: Lap[];

    private qTableSoFar: QTable;
    private chunkSize: number;
    
    constructor(chunkSize: number) {
        this.log = [];
        this.laps = [];

        this.qTableSoFar = new QTable();
        this.chunkSize = chunkSize;
    }

    public get deathCount() : number { return this.log.filter(e=>e instanceof AIRestoreFrames).length; }

    public addLogEntry(entry: AIFrame | AIRestoreFrames) {
        this.applyLogEntryToQTable(entry, this.qTableSoFar);
        this.log.push(entry);
    }

    public checkThatPreviousFrameWasRestore() {
        assert(this.log[this.topLogIndex] instanceof AIRestoreFrames, "Expected to have just had a restore set");
    }

    public getAllDeathTimes() : number[] {
        const deathTimes: number[] = [];
        this.iterateThroughLogWithTimes(function(entry: (AIFrame | AIRestoreFrames), curFrames: number) {
            if(entry instanceof AIRestoreFrames) {
                deathTimes.push(curFrames+1);
            }
            return true;
        });
        assert(deathTimes.length === this.deathCount, "Mismatch of deathtimes array size");
        return deathTimes;
    }

    public getTotalFramesSoFar() {
        return this.iterateThroughLogWithTimes(()=>true);
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

    public getPathBetweenTimeStamps(startInclusive: number, endInclusive: number) {
        const path = new PathSegment();
        this.iterateThroughLogWithTimes(function(entry: (AIFrame | AIRestoreFrames), curFrames: number) {
            if(curFrames > endInclusive) {
                return false;
            }
            
            if(entry instanceof AIRestoreFrames) {
                let restoreFrames = entry.frameCount;
                if(startInclusive > curFrames) {
                    restoreFrames -= startInclusive - curFrames;
                }
                if(endInclusive < (curFrames + entry.frameCount)) {
                    restoreFrames -= (curFrames + entry.frameCount) - endInclusive;
                }
                if(restoreFrames > 0) {
                    path.path.push(new PathHistorySegmentDeath(restoreFrames));
                }
            } else if(curFrames >= startInclusive) {
                path.path.push(entry.vehiclePos);
            }
            return true;
        });

        assert(path.totalFrames === (endInclusive-startInclusive)+1, "Path size incorrect");
        return path;
    }

    private get topLogIndex() : number { return this.log.length - 1; }

    private iterateThroughLogWithTimes(loopFn: (e: (AIFrame | AIRestoreFrames), st: number) => boolean) {
        let curFrames = 0;
        for(const entry of this.log) {
            const continueLoop = loopFn(entry, curFrames);
            if(!continueLoop) {
                return curFrames;
            }

            if(entry instanceof AIRestoreFrames) {
                curFrames += entry.frameCount;
            } else {
                curFrames++;
            }
        }
        return curFrames;
    }

    private applyLogEntryToQTable(entry: AIFrame | AIRestoreFrames, qTable: QTable) {
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
    private allChunkCoords: Position[];

    constructor() {
        this.chunks = [];
        this._chunkCount = 0;
        this.allChunkCoords = [];
    }

    public get chunkCount() { return this._chunkCount; }
    public get chunkCoords() { return this.allChunkCoords; }

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
            this.allChunkCoords.push(new Position(x,y,z));
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

class AISession {
    public sessionInfo: SessionInfo;
    public history: AIHistoryLog;

    constructor(sessionInfo: SessionInfo, history: AIHistoryLog) {
        this.sessionInfo = sessionInfo;
        this.history = history;
    }
}