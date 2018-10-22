function alertError(str: string) {
    debugger;
    alert(str);
}

function assert(condition: boolean, errorString: string) {
    if(!condition) {
        alertError(errorString);
    }
}

window.onerror = function(event) {
    alertError(event.toString());
};