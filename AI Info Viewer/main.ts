const logFile = "dolphin.log";

startLogParsing();

function startLogParsing() {
    fetch(logFile)
    .then(response => response.text())
    .then(function(text) {
        const parser = new LogParser(text);
        const info = parser.interpretLog();
        displayInfo(info);
    });
}

function displayInfo(session: AISession) {
    console.log('Laps:');
    console.log(session.history.laps.map(l=>l.timeMillis).join(";"));
    console.log('Death times:');
    console.log(session.history.getAllDeathTimes().join(";"));

    const qTable = session.history.constructQTableAsOfNow();

    const scene = createScene();
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    for(const coord of qTable.chunkCoords) {
        const val = qTable.getChunk(coord).getValue(true, Action.FORWARD);
        const color = new THREE.Color(val/2000, val/2000, val/2000);
        const material = new THREE.MeshBasicMaterial({ color: color });
        const cube = new THREE.Mesh(geometry, material);
        cube.position.set(coord.x, coord.y, coord.z);
        scene.add( cube );
    }
}

function createScene() {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 100;
    const controls = new THREE.OrbitControls( camera );

    const renderer = new THREE.WebGLRenderer();
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
