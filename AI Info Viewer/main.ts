const logFile = "dolphin.log";

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

function displayInfo(session: AISession) {
    console.log('Laps:');
    console.log(session.history.laps.map(l=>l.timeMillis).join(";"));
    console.log('Death times:');
    console.log(session.history.getAllDeathTimes().join(";"));

    const qTable = session.history.constructQTableAsOfNow();

    const chunkSize = session.sessionInfo.chunkSize;

    const scene = createScene();
    const geometry = new THREE.BoxGeometry(chunkSize, chunkSize, chunkSize);
    for(const coord of qTable.chunkCoords) {
        const val = qTable.getChunk(coord).getValue(true, Action.FORWARD);
        const color = new THREE.Color(val/2000, val/2000, val/2000);
        const material = new THREE.MeshBasicMaterial({ color: color });
        material.transparent = true;
        material.opacity = 0.05;
        const cube = new THREE.Mesh(geometry, material);
        cube.position.set(coord.x * chunkSize, coord.y * chunkSize, coord.z * chunkSize);
        scene.add( cube );
    }
    const firstLapEndTime = session.history.laps[20].endFrame;
    const path = session.history.getPathBetweenTimeStamps(0, firstLapEndTime);

    const lineMaterial = new THREE.LineBasicMaterial({ color: 0xff0000 });
    lineMaterial.linewidth = 5;
    let lineGeometry = new THREE.Geometry();

    for(const elem of path.path) {
        if(elem instanceof Position) {
            lineGeometry.vertices.push(
                new THREE.Vector3(elem.x, elem.y, elem.z),
            );
        } else {
            scene.add(new THREE.Line( lineGeometry, lineMaterial ));
            lineGeometry = new THREE.Geometry();
        }
    }
    scene.add(new THREE.Line( lineGeometry, lineMaterial ));
}

function createScene() {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100000);
    camera.position.z = 1000;
    const controls = new THREE.OrbitControls( camera );

    const renderer = new THREE.WebGLRenderer({ alpha: true });
    renderer.setClearColor('skyblue');
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    function animate() {
        requestAnimationFrame( animate );
        controls.update();
        renderer.render( scene, camera );
    }
    animate();
    return scene;
}
