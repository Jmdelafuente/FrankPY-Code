const express = require('express');
const bodyParser = require('body-parser');
const cors = require("cors");
//const mongoose = require('mongoose');
//const apiRouter = require('./app/services');
const fs = require('fs');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        "methods": "*",
        "preflightContinue": false,
    }
});
const { v4: uuidv4 } = require("uuid");

let {PythonShell} = require('python-shell');

let opciones = {
    mode : 'text', //podría ser JSON
    pythonPath: '/usr/bin/python2.7',
    pythonOptions: ['-u'],
    args: []
};
let Socket;
let Users = [];
var Shells = {};
var sockets = {};
var robotReady = false;

app.use(cors());
app.options('*', cors())
app.use(express.static(__dirname + '/public')); //HTML por defecto, estatico, sin template engines
app.use(bodyParser.urlencoded({extended: true}));

app.get('/', function (req, res) {
    res
        .status(200)
        .sendFile(__dirname + '/public/home.html');
});

app.get('/ventanaIO', function (req, res) {
    res
        .status(200)
        .sendFile(__dirname + '/public/ventanaIO.html');
});


app.get('/sse', function(req,res) {
    const headers = {
      "Content-Type": "text/event-stream",
      "Connection": "keep-alive",
      "Cache-Control": "no-cache",
    };
    res.writeHead(200, headers);
    Users.push(res);
    res.write("\n");
});

app.post("/guardarXML", function (req, res) {
    // id = req.body.token || uuidv4();
    let id = req.body.token ? req.body.token : uuidv4();
    saveXML(req.body.codigo,id);
    res.set("Content-Type", "text/plain");
    res.send(id);
});

app.get("/cargarXML", function(req,res){
    let xml = "";
    if(req.query.token){
        xml = loadXML(req.query.token);
    }
    res.set("Content-Type", "text/plain");
    res.send(xml);
});

app.post('/procesar', function (req, res) { //queda pending despues de ejecutar en chrome

    let codigoLimpio = "# coding: latin-1\n" + req.body.codigo; //toString??
    let id = req.body.token ? req.body.token : uuidv4();

    fs.writeFile(__dirname + `/scriptUsuario${id}.py`, codigoLimpio, function (err) {
        if (err) throw err;
    });

    let pyshell = new PythonShell(__dirname + `/scriptUsuario${id}.py`, opciones);
    Shells[id] = pyshell;
	
    pyshell.on('message', function (msj) {
		let printable = true;
		if (msj.includes("-> Frankestito listo")) {
			robotReady = true;
		}
        if (msj.includes("@autogenerated@begin@")) {
            msj = msj.replace("@autogenerated@begin@", "");
            Users.forEach(res => {
                res.write(`data: ${JSON.stringify({ id: msj.slice(1, -1) })} \n\n`);
            });
            printable = false;
        }
        if (msj.includes("@autogenerated@input@")) {
            msj = msj.replace(`@autogenerated@input@`, "");
            printable = false;
            io.in(id).emit('input', msj)
        }
        if(printable && robotReady){
            io.in(id).emit('mensaje', msj);
        }
    });

    pyshell.on('error', function (err) {
        console.log(` error en cliente ${id}: `, err);
        io.emit('mensaje', err.toString());
    });

    pyshell.on('close', function (err) {
        console.log(`Entro a close para el cliente ${id}`);
		robotReady = false;
        Users.forEach((res) => {
          res.write(`data: ${JSON.stringify({ id: -1 })} \n\n`);
        });
        pyshell = null;
        fs.unlink(__dirname + `/scriptUsuario${id}.py`, (err)=>{
            if(err){
                console.log(`Ha ocurrido un error eliminando el archivo temporal scriptUsuario${id}.py`);
                console.log(err);
            }
        });
    });
    // TODO: retrive available robot URL
    res.send("http://10.0.20.223:8080/?action=stream");
});

io.on('connection', (socket) => {
    let id = uuidv4();
    socket.join(id) // Force to use a room -> For future collaboration
    socket.emit('connection', id); // Assign an ID
    sockets[socket.id] = id; // Save assignation

    socket.on('valorIO', (msj) => {
        try {
            Shells[msj.id].send(msj.value); /** envio al script de python (lo toma como entrada estandar) el valor
             ingresado por el usuario en la ventana de IO**/
        } catch (error) {
            console.error(error);
        }
    });

    socket.on("disconnect", (reason) => {
        let id = sockets[socket.id];
        if ((reason == "transport close" || reason == "transport error") && sockets[id]) {
            delete sockets[id];
            setTimeout(function () {
                let s = sockets[id];
                if (typeof s !== "undefined") {
                    try {
                        Shells[id].end(() => console.log(`Terminado el cliente ${id}`));
                    } catch (error) {
                        console.log(error);
                    }
                }
            }, 60000);
        }
    });
});

function saveXML(xml,id){
    fs.writeFile(`${id}.xml`, xml, function (err) {
      if (err) return console.log(err);
      console.log(`Guardando archivo ${id}.xml`);
    });
}

function loadXML(id){
    console.log(`Cargando el archivo ${id}.xml`);
    try {
        var data = fs.readFileSync(`${id}.xml`, "utf8");
        return data;
    } catch (e) {
      console.log("Error:", e.stack);
    }
}

http.listen(port = 3000, function () {
    console.log('Escuchando en el puerto 3000');
});
