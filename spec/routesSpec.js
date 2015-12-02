"use strict"

//process.env.NODE_ENV = 'test';

var request = require('supertest');
var server = require('../server');
var express = require('express');
var app = server.app;

/* database setup */
var database = require('../config/database');
var mongoose = require('mongoose');
mongoose.connect(database.url);
var db = mongoose.connection;

/* load db models */
var Users = require('../app/models/user');
var MessageQueue = require('../app/models/messageQueue');

/* socket.io */
var ioClient = require('socket.io-client');
var options ={
  transports: ['websocket'],
  'force new connection': true
};


/* Load protobuf helper methods */
var helper = require('../app/helperFunctions');

/* Constants */
var NUMBER_PREKEYS_CREATED = 3;

/* auth variables */
var authUn;
var authUnBadDid;
var authPass;
var authPassBadSig;
var authPassFuture;
var authPassPast;
var prekeys; //array of array buffer prekeys
var lastResortKey; //singular array buffer prekey
var protoPrekeys; //sungular protobuf "prekeys" message
var prekeysObj;


describe("Routes:", function(done) {

    it('Create Credentials & Keys for testing', function(done) {
        request(app)
        .get('/test/axolotl/'+String(NUMBER_PREKEYS_CREATED))
        .end(function(err, res) {
            if (err) {
                throw err;
            }
            authUn = res.body.basicAuthUserName;
            authPass = res.body.basicAuthPassword;
            authUnBadDid = res.body.badDidUserName;
            authPassBadSig = res.body.badSignaturePassword;
            authPassFuture = res.body.futurePassword;
            authPassPast = res.body.pastPassword;
            lastResortKey = res.body.lastResortKey;
            prekeys = res.body.preKeys;
            prekeysObj = helper.prekeysObjectConstructor(lastResortKey, prekeys);
            done();
        });
    });


    describe("Sockets:", function(){
        describe("Auth not registered", function(){
            it('should connect & return not registered', function(done){
                var socket = ioClient.connect("http://localhost:8080", options);
                socket.once('connect', function(data){
                    socket.emit('authentication', { username:authUn, password:authPass });
                    socket.once('not authorized', function(data) {
                        console.log("ERROR MESSAGE: "+data.message);
                        expect(data.message).toBe('not registered');
                        socket.disconnect();
                        done();
                    });
                });
            });
        });
    });


    describe('Regular Authentication, not registered:', function() {
        describe('Try Valid Credentials:', function() {
            describe('POST /api/v1/key/update/', function() {
                it('should respond with 401, not registered', function(done){
                    request(app)
                    .post('/api/v1/key/update/')
                    .auth(authUn, authPass)
                    .expect(401, 'not registered', done);
                });
            });
            describe('GET /api/v1/key/', function() {
                it('should respond with 401, not registered', function(done){
                    request(app)
                    .get('/api/v1/key/')
                    .auth(authUn, authPass)
                    .expect(401, 'not registered', done);
                });
            });
            describe('POST /api/v1/message/', function() {
                it('should respond with 401, not registered', function(done){
                    request(app)
                    .post('/api/v1/message/')
                    .auth(authUn, authPass)
                    .expect(401, 'not registered', done);
                });
            });
        });//end of 'Valid Credentials'
    });//end of decribe 'Regular Authentication, not registered'

    describe('Initial Authentication, not registered:', function() {
        describe('POST /api/v1/key/initial/', function() {
            describe('Try Invalid Credentials', function() {
                it('Bad Signature: should respond with 401, signature', function(done){
                    request(app)
                    .post('/api/v1/key/initial/')
                    .auth(authUn, authPassBadSig)
                    .set('Content-Type', 'application/json')
                    .send(prekeysObj)
                    .expect(401, 'signature', done);
                });
                it('Future Password: should respond with 401, time & time in \'Server-Time\' header', function(done){
                    request(app)
                    .post('/api/v1/key/initial/')
                    .auth(authUn, authPassFuture)
                    .set('Content-Type', 'application/json')
                    .send(prekeysObj)
                    .expect('Server-Time', /[0-9]*/)
                    .expect(401, 'time', done);
                });
                it('Past Password: should respond with 401, time & time in \'Server-Time\' header', function(done){
                    request(app)
                    .post('/api/v1/key/initial/')
                    .auth(authUn, authPassPast)
                    .set('Content-Type', 'application/json')
                    .send(prekeysObj)
                    .expect('Server-Time', /[0-9]*/)
                    .expect(401, 'time', done);
                });
            });
            describe('Try Valid Credentials:', function() {
                it('should respond with 200', function(done){
                    /////console.log("SENDER-PRE-ENC: %j", protoPrekeys.prekeys[0]);
                    request(app)
                    .post('/api/v1/key/initial/')
                    .auth(authUn, authPass)
                    .set('Content-Type', 'application/json')
                    .send(prekeysObj)
                    .expect(200, done);
                });
                it('new user should be in database', function(done){
                    Users.findOne({identityKey : authUn.split("|")[0]}, function(err, dbUser) {
                        expect(dbUser).toBeDefined();
                        done();
                    });
                });
                it('new user should be pupulated appropriately', function(done){
                    Users.findOne({identityKey : authUn.split("|")[0]}, function(err, dbUser) {
                        expect(dbUser.revoked).toBe(false);
                        expect(dbUser.devices.numberOfDevices).toEqual(1);
                        expect(dbUser.devices[authUn.split("|")[1]]).toBeDefined();
                        expect(dbUser.devices[authUn.split("|")[1]].lastResortKey).toBeDefined();
                        expect(dbUser.devices[authUn.split("|")[1]].prekeys.length).toEqual(NUMBER_PREKEYS_CREATED-1);
                        done();
                    });
                });
            });
        });//end of 'Valid Credentials'
    });//end of decribe 'Initial Authentication, not registered'

    describe('Sockets Registered:', function(){
        describe('Registered:', function(){
            it('should connect & return authorized', function(done){
                var socket = ioClient.connect("http://localhost:8080", options);
                socket.once('connect', function(data){
                    socket.emit('authentication', { username:authUn, password:authPass });
                    socket.once('authorized', function(data) {
                        socket.disconnect();
                        done();
                    });
                });

            });
        });
    });

    describe('Regular Authentication, Registered', function() {
        describe('GET /api/v1/key/', function() {
            describe('Try Invalid Credentials', function() {
                it('Bad Signature: should respond with 401, signature', function(done){
                    request(app)
                    .get('/api/v1/key/')
                    .auth(authUn, authPassBadSig)
                    .set('Content-Type', 'application/json')
                    .send({identityKey : authUn.split("|")[0]})
                    .expect(401, 'signature', done);
                });
                it('Future Password: should respond with 401, time & time in \'Server-Time\' header', function(done){
                    request(app)
                    .get('/api/v1/key/')
                    .auth(authUn, authPassFuture)
                    .set('Content-Type', 'application/json')
                    .send({identityKey : authUn.split("|")[0]})
                    .expect('Server-Time', /[0-9]*/)
                    .expect(401, 'time', done);
                });
                it('Past Password: should respond with 401, time & time in \'Server-Time\' header', function(done){
                    request(app)
                    .get('/api/v1/key/')
                    .auth(authUn, authPassPast)
                    .set('Content-Type', 'application/json')
                    .send({identityKey : authUn.split("|")[0]})
                    .expect('Server-Time', /[0-9]*/)
                    .expect(401, 'time', done);
                });
            });//end of 'Try Invalid Credentials'
            describe('Try Valid Credentials', function() {
                it('should respond with 200 & list of matching prekeys', function(done){
                    request(app)
                    .get('/api/v1/key/')
                    .auth(authUn, authPass)
                    .set('Content-Type', 'application/json')
                    .send({identityKey : authUn.split("|")[0]})
                    //.expect(200, done);
                    .end(function(err, res) {
                        if(err) {
                            throw err;
                        }
                        expect(res.status).toEqual(200);
                        //expect prekey of deviceId
                        expect(res.body[authUn.split("|")[1]]).toBeDefined();
                        //expect prekey to match
                        var recievedPrekey = res.body[authUn.split("|")[1]];
                        expect(recievedPrekey).toEqual(helper.base64EncodePrekey(prekeys[0]));
                        done();
                    });
                });
            });//end of 'Try Valid Credentials'
            describe ('Consume all prekeys', function() {
                it('should respond with 205', function(done) {
                    request(app)
                    .get('/api/v1/key/')
                    .auth(authUn, authPass)
                    .set('Content-Type', 'application/json')
                    .send({identityKey : authUn.split("|")[0]})
                    .end(function(err, res) {
                        if (err) {
                            throw err;
                        }
                        expect(res.status).toEqual(205);
                        done();
                    });
                });
                it('device should have no prekeys', function(done){
                    Users.findOne({identityKey : authUn.split("|")[0]}, function(err, dbUser) {
                        expect(dbUser.devices[authUn.split("|")[1]].prekeys.length).toEqual(0);
                        done();
                    });
                });
                it('should respond with 205 & lastResortKey', function(done) {
                    request(app)
                    .get('/api/v1/key/')
                    .auth(authUn, authPass)
                    .set('Content-Type', 'application/json')
                    .send({identityKey : authUn.split("|")[0]})
                    .end(function(err, res) {
                        if (err) {
                            throw err;
                        }
                        expect(res.status).toEqual(205);
                        //expect prekey of deviceId
                        expect(res.body[authUn.split("|")[1]]).toBeDefined();
                        //expect prekey to match
                        var recievedPrekey = res.body[authUn.split("|")[1]];
                        expect(recievedPrekey).toEqual(helper.base64EncodePrekey(lastResortKey));
                        done();
                    });
                });
            });//end of 'Consume all prekeys'
        }); //end of 'GET /api/v1/key/'
        describe('POST /api/v1/key/update/', function(){
            describe('Try Invalid Credentials', function() {
                it('Bad Signature: should respond with 401, signature', function(done){
                    request(app)
                    .post('/api/v1/key/update/')
                    .auth(authUn, authPassBadSig)
                    .set('Content-Type', 'application/json')
                    .send(prekeysObj)
                    .expect(401, 'signature', done);
                });
                it('Future Password: should respond with 401, time & time in \'Server-Time\' header', function(done){
                    request(app)
                    .post('/api/v1/key/update/')
                    .auth(authUn, authPassFuture)
                    .set('Content-Type', 'application/json')
                    .send(prekeysObj)
                    .expect('Server-Time', /[0-9]*/)
                    .expect(401, 'time', done);
                });
                it('Past Password: should respond with 401, time & time in \'Server-Time\' header', function(done){
                    request(app)
                    .post('/api/v1/key/update/')
                    .auth(authUn, authPassPast)
                    .set('Content-Type', 'application/json')
                    .send(prekeysObj)
                    .expect('Server-Time', /[0-9]*/)
                    .expect(401, 'time', done);
                });
            });//end of 'Invalid Credentials'
            describe('Try Valid Credentials:', function() {
                it('should respond with 200', function(done){
                    request(app)
                    .post('/api/v1/key/update/')
                    .auth(authUn, authPass)
                    .set('Content-Type', 'application/json')
                    .send(prekeysObj)
                    .expect(200, done);
                });
                it('should have 2 prekeys in DB', function(done){
                    Users.findOne({identityKey : authUn.split("|")[0]}, function(err, dbUser) {
                        expect(dbUser.devices[authUn.split("|")[1]].prekeys.length).toEqual(NUMBER_PREKEYS_CREATED-1);
                        done();
                    });
                });
                it('fetching keys should respond with 200 & list of matching prekeys', function(done){
                    request(app)
                    .get('/api/v1/key/')
                    .auth(authUn, authPass)
                    .set('Content-Type', 'application/json')
                    .send({identityKey : authUn.split("|")[0]})
                    //.expect(200, done);
                    .end(function(err, res) {
                        if(err) {
                            throw err;
                        }
                        expect(res.status).toEqual(200);
                        //expect prekey of deviceId
                        expect(res.body[authUn.split("|")[1]]).toBeDefined();
                        //expect prekey to match
                        var recievedPrekey = res.body[authUn.split("|")[1]];
                        expect(recievedPrekey).toEqual(helper.base64EncodePrekey(prekeys[0]));
                        done();
                    });
                });

            });//end of 'Valid Credentials'
        }); //end of 'POST /api/v1/key/update'
        describe('POST /api/v1/message/', function(){
            describe('Try Invalid Credentials', function() {
                it('Bad Signature: should respond with 401', function(done){
                    request(app)
                    .post('/api/v1/message/')
                    .auth(authUn, authPassBadSig)
                    .expect(401, 'signature', done);
                });
                it('Future Password: should respond with 401, time & time in \'Server-Time\' header', function(done){
                    request(app)
                    .post('/api/v1/message/')
                    .auth(authUn, authPassFuture)
                    .expect('Server-Time', /[0-9]*/)
                    .expect(401, 'time', done);
                });
                it('Past Password: should respond with 401, time & time in \'Server-Time\' header', function(done){
                    request(app)
                    .post('/api/v1/message/')
                    .auth(authUn, authPassPast)
                    .expect('Server-Time', /[0-9]*/)
                    .expect(401, 'time', done);
                });
            });//end of 'Invalid Credentials'
            describe('Try Valid Credentials:', function() {
                var beforeCount;
                var numMessages = 1;
                it('get count of messages in queue', function(done) {
                    MessageQueue.count({}, function(err, count){
                        beforeCount = count;
                        done();
                    });
                });
                it('should respond with 200 & '+numMessages+' messagesQueued', function(done){
                    request(app)
                    .post('/api/v1/message/')
                    .auth(authUn, authPass)
                    .set('Content-Type', 'application/json')
                    .send({messages: [{headers:[{recipient: authUn, messageHeader: "base64 encoded string"},], body: "base64 encoded string"},]})
                    .expect(function(res) {
                        res.body.messagesQueued = numMessages;
                    })
                    .expect(200, done);
                });
                    //var numMessages = messagesJson.messages.length;
                it('MessageQueue model should have '+numMessages+' new entries', function(done){
                    MessageQueue.count({}, function(err, afterCount){
                        expect(afterCount).toEqual(beforeCount+numMessages);
                        done();
                    });
                });
                it('entry in MessageQueue should be populated properly', function(done){
                    MessageQueue.findOne({recipientIdKey : authUn.split("|")[0]}, function(err, doc){
                                           expect(doc._id).toBeDefined();
                                           expect(doc.messageHeader).toBeDefined();
                                           expect(doc.messageBody).toBeDefined();
                                           expect(doc.recipientIdKey).toBeDefined();
                                           expect(doc.recipientDid).toBeDefined();
                                           done();
                                       });
                });

            });//end of 'Valid Credentials'
        }); //end of 'POST /api/v1/message/'

        describe('Sockets:', function(){
            describe('Message on server:', function(){
                it('should connect & return message', function(done){
                    var socket = ioClient.connect("http://localhost:8080", options);
                    socket.once('connect', function(data){
                        socket.emit('authentication', { username:authUn, password:authPass });
                        socket.once('message', function(messageData) {
                            expect(messageData.header).toBeDefined();
                            expect(messageData.body).toBeDefined();
                            expect(messageData.id).toBeDefined();
                            //confirm reception of message
                            socket.emit('recieved', {messageId: messageData.id});
                            socket.disconnect();
                            done();
                        });
                    });

                });
                it('all messages for recipient should be removed from DB', function(done) {
                    MessageQueue.count({recipientIdKey: authUn.split("|")[0],
                                        recipientDid: authUn.split("|")[1]}, function(err, count){
                        expect(count).toEqual(0);
                        done();
                    });
                });
                it('should recieve push message imediately after sending when sockets are connected', function(done){
                    //connect to socket
                    var socket = ioClient.connect("http://localhost:8080", options);
                    socket.once('connect', function(data){
                        socket.emit('authentication', { username:authUn, password:authPass });
                        socket.on('message', function(messageData) {
                            expect(messageData.header).toBeDefined();
                            expect(messageData.body).toBeDefined();
                            expect(messageData.id).toBeDefined();
                            //confirm reception of message
                            socket.emit('recieved', {messageId: messageData.id});
                            socket.disconnect();
                            done();
                        });
                    });
                    //submit Message
                    request(app)
                    .post('/api/v1/message/')
                    .auth(authUn, authPass)
                    .set('Content-Type', 'application/json')
                    .send({messages: [{headers:[{recipient: authUn, messageHeader: "base64 encoded string"},], body: "base64 encoded string"},]})
                    .expect(function(res) {
                        res.body.messagesQueued = 1;
                        //res.body.keysNotFound.length = 0;
                        //res.body.revokedKeys.length = 0;
                        //res.body.missingDevices.length = 0;
                    })
                    .expect(200);
                });
            });
        });
        /*======= Delete device =======*/
        describe('DELETE /api/v1/key/', function(){
            describe('Try Invalid Credentials', function() {
                it('Bad Signature: should respond with 401, signature', function(done){
                    request(app)
                    .delete('/api/v1/key/')
                    .auth(authUn, authPassBadSig)
                    .expect(401, 'signature', done);
                });
                it('Future Password: should respond with 401, time & time in \'Server-Time\' header', function(done){
                    request(app)
                    .delete('/api/v1/key/')
                    .auth(authUn, authPassFuture)
                    .expect('Server-Time', /[0-9]*/)
                    .expect(401, 'time', done);
                });
                it('Past Password: should respond with 401, time & time in \'Server-Time\' header', function(done){
                    request(app)
                    .delete('/api/v1/key/')
                    .auth(authUn, authPassPast)
                    .expect('Server-Time', /[0-9]*/)
                    .expect(401, 'time', done);
                });
            });//end of invalid credentials
            describe('Try Valid Credentials:', function() {
                it('should respond with 200', function(done){
                    request(app)
                    .delete('/api/v1/key/')
                    .auth(authUn, authPass)
                    .expect(200, done);
                });
                it('device should be deleted from database', function(done){
                    Users.findOne({identityKey : authUn.split("|")[0]}, function(err, dbUser) {
                        expect(dbUser.devices[authUn.split("|")[1]]).not.toBeDefined();
                        done();
                    });
                });
                it('identityKey should be revoked in database', function(done){
                    Users.findOne({identityKey : authUn.split("|")[0]}, function(err, dbUser) {
                        expect(dbUser.revoked).toBe(true);
                        done();
                    });
                });
            });//end of 'Valid Credentials'
        }); //end of 'DELETE /api/v1/key/'
    }); //end of 'Regular Authentication, Registered'

    describe('Regular Authentication, Revoked', function() {
        describe('Try Valid Credentials:', function() {
            it('should respond with 401, not registered', function(done){
                request(app)
                .get('/api/v1/key/')
                .auth(authUn, authPass)
                .send({identityKey : authUn.split("|")[0]})
                .expect(401, 'not registered', done);
            });
        });//end of 'Valid Credentials'
    });

    it('Close Server', function(done) {
        server.close();
        done();
    });
});

/* Helper Functions */
function binaryParser(res, callback) {
    res.setEncoding('binary');
    res.data = '';
    res.on('data', function (chunk) {
        res.data += chunk;
    });
    res.on('end', function () {
        callback(null, new Buffer(res.data, 'binary'));
    });
}
