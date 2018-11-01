const logFile = "dolphin.log";

let textOutput: HTMLTextAreaElement;
window.onload = function() { 
    textOutput = document.getElementById("text-output") as HTMLTextAreaElement;
    if(textOutput === null || textOutput === undefined) {
        alertError("Textoutput is null");
    }
};

let aiSession: AISession;

startLogParsing();

function startLogParsing() {
    fetch("logs/"+logFile)
    .then(response => response.text())
    .then(function(text) {
        const parser = new LogParser(text);
        const info = parser.parse();
        displayInfo(info);
    });
}

function clearTextDisplay() {
    textOutput.value = "";
}
function writeToTextDisplay(str: string) {
    textOutput.value += `${str}`;
}
function writeLineToTextDisplay(str: string = "") {
    textOutput.value += `${str}\r\n`;
}

function displayCommonInfoText() {
    const sesInfo = aiSession.sessionInfo;
    writeLineToTextDisplay(`${sesInfo.hoursToNoExploration} hours to 0 exploration`);
    writeLineToTextDisplay(`Learn rate: ${sesInfo.learningRate} | Discount rate: ${sesInfo.discountRate}`);
    writeLineToTextDisplay(`Chunk size: ${sesInfo.chunkSize}`);
    writeLineToTextDisplay();
    writeLineToTextDisplay(`Total frames:    ${aiSession.history.getTotalFramesSoFar()}`);
    writeLineToTextDisplay(`Frames learning: ${aiSession.sessionInfo.totalLearnFrames}`);
    writeLineToTextDisplay(`Frames no learn: ${aiSession.sessionInfo.totalNoLearnFrames}`);
    writeLineToTextDisplay(`Frames dead:     ${aiSession.sessionInfo.totalCrashFrames}`);
    writeLineToTextDisplay(`Frames lost:     ${aiSession.sessionInfo.totalLostFrames}`);
    writeLineToTextDisplay("===========================================================");
}

function displayInfo(session: AISession) {
    aiSession = session;

    displayCommonInfoText();
    writeLineToTextDisplay('Laps times (millis):');
    writeLineToTextDisplay(session.history.laps.map(l=>l.timeMillis).join("\r\n"));
    writeLineToTextDisplay();
    writeLineToTextDisplay('Death times:');
    writeLineToTextDisplay(session.history.getAllDeathTimes().join("\r\n"));

    const qTable = session.history.constructQTableAsOfNow();
    const chunkSize = session.sessionInfo.chunkSize;

    const visualizer = new ChunkVisualizer(chunkSize);
    visualizer.onChunkClickedCallback = updateInfoText;
    for(const coord of qTable.chunkCoords) {
        const val = qTable.getChunk(coord).getValue(true, Action.FORWARD);
        visualizer.addChunk(coord, val/2000);
    }
}

function updateInfoText(chunkPos: AIPosition) {
    const sesInfo = aiSession.sessionInfo;
    clearTextDisplay();
    displayCommonInfoText();

    const frames = aiSession.history.getFramesAssociatedWithChunk(chunkPos);
    writeLineToTextDisplay(`Selected chunk: (${chunkPos.x}, ${chunkPos.y}, ${chunkPos.z})`);

    let framesStr = "";
    let visitCount = 0;
    let updateCount = 0;

    let prevFrame: AIFrame | null = null;
    let prevFrameNumber = -1;
    let expectingQTableUpdate = false;
    for(const [frameInfo, frameNumber] of frames) {
        if(frameInfo.qTableUpdate !== null && frameInfo.qTableUpdate.updatedStateChunkPosition.equals(chunkPos)) {
            // Chunk table was updated
            updateCount++;
            expectingQTableUpdate = false;
            
            if(prevFrame === null || prevFrameNumber+1 !== frameNumber) {
                alertError("Unexpected update");
                framesStr += "Unexpected update\r\n";
            } else if(prevFrame !== null) {
                assert(frameInfo.qTableUpdate.actionIndex === prevFrame.actionTaken,"Invalid frame pairing");
                framesStr += ` -> ${frameInfo.qTableUpdate.newValue}\r\n`;
            }
        } else if(expectingQTableUpdate) {
            framesStr += " -> [NO UPDATE]\r\n";
            expectingQTableUpdate = false;
        }
        if(chunkContainingPosition(frameInfo.vehiclePos, sesInfo.chunkSize).equals(chunkPos)) {
            expectingQTableUpdate = true;
            visitCount++;
            framesStr += `F${frameNumber}: `;
            framesStr += `rw=${frameInfo.vehicleGoingRightDirection ? 'O' : 'X'} best=${frameInfo.bestActionTaken ? 'O' : 'X'} ${Action[frameInfo.actionTaken]}`;
        }
        prevFrame = frameInfo;
        prevFrameNumber = frameNumber;
    }
    if(expectingQTableUpdate) {
        framesStr += " -> [NO UPDATE]\r\n";
    }

    writeLineToTextDisplay(`Visit/Update: ${visitCount}/${updateCount}`);
    writeLineToTextDisplay("----------------");
    writeToTextDisplay(framesStr);
}

class ChunkVisualizer {
    private readonly renderWidth = window.innerWidth/2;
    private readonly renderHeight = window.innerHeight;

    private scene: THREE.Scene;
    private camera: THREE.PerspectiveCamera;
    private controls: THREE.OrbitControls;
    private renderer: THREE.WebGLRenderer;
    private raycaster: THREE.Raycaster;

    private mousePosNormalized = new THREE.Vector2();
    private mouseClick = false;

    private chunkSize: number;
    private chunkGeometry: THREE.BoxGeometry;
    private meshToChunkPosMap = new Map<THREE.Object3D, AIPosition>();

    private get mouseIsOverCanvas(): boolean {
        return Math.abs(this.mousePosNormalized.x) <= 1
            && Math.abs(this.mousePosNormalized.y) <= 1;
    }

    public onChunkClickedCallback: (pos: AIPosition) =>void = ()=>{};

    public constructor(chunkSize: number) {
        this.chunkSize = chunkSize;
        this.chunkGeometry = new THREE.BoxGeometry(chunkSize, chunkSize, chunkSize);

        this.raycaster = new THREE.Raycaster();

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, this.renderWidth / this.renderHeight, 0.1, 100000);
        this.camera.position.z = 1000;
        this.controls = new THREE.OrbitControls(this.camera);

        this.renderer = new THREE.WebGLRenderer({ alpha: true });
        this.renderer.setClearColor('skyblue');
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(this.renderWidth, this.renderHeight);
        document.body.appendChild(this.renderer.domElement);

        this.onFrameRequest();

        window.addEventListener('mousedown', ()=>this.mouseClick = true);
        window.addEventListener('mouseup', ()=>this.mouseClick = false);
        window.addEventListener('mousemove', this.onMouseMove.bind(this));
    }

    public addChunk(position: AIPosition, brightness: number) {
        const color = new THREE.Color(brightness, brightness, brightness);
        const material = new THREE.MeshBasicMaterial({ color: color });
        //material.transparent = true;
        //material.opacity = 0.05;
        const cube = new THREE.Mesh(this.chunkGeometry, material);
        cube.position.set(position.x * this.chunkSize, position.y * this.chunkSize, position.z * this.chunkSize);
        this.scene.add(cube);
        this.meshToChunkPosMap.set(cube, position);
    }

    private onMouseMove(event: MouseEvent) {
        const canvasRect = this.renderer.domElement.getBoundingClientRect();
        const x = event.clientX - canvasRect.left;
        const y = event.clientY - canvasRect.top;
        this.mousePosNormalized.x = (x / canvasRect.width) * 2 - 1;
        this.mousePosNormalized.y = -(y / canvasRect.height) * 2 + 1;
    }

    private onFrameRequest() {
        requestAnimationFrame(this.onFrameRequest.bind(this));
        this.controls.enabled = this.mouseIsOverCanvas;

        if(this.mouseIsOverCanvas && this.mouseClick) {
            this.raycaster.setFromCamera(this.mousePosNormalized, this.camera);
            const intersections = this.raycaster.intersectObjects(this.scene.children);
            if(intersections.length > 0) {
                const pos = this.meshToChunkPosMap.get(intersections[0].object);
                if(pos === undefined) {
                    alertError("bad");
                } else {
                    this.onChunkClickedCallback(pos);
                }
            }
        }

        this.mouseClick = false;

        this.renderer.render(this.scene, this.camera);
    }
}
