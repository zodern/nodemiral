var fs = require('fs');
var ejs = require('ejs');
var debug = require('debug');
var SSHClient = require('./ssh');
var _ = require('underscore');
var ProgressBar = require('progress');

function Session(host, auth, options) {
  if(!(this instanceof Session)) {
    return new Session(host, auth, options);
  }

  this._host = host;
  this._auth = auth;
  this._options = options || {};
  this._keepAlive = !!this._options.keepAlive;

  this._tasks = [];
  this._callbacks = [];

  this._debug = debug('nodemiral:sess:' + host);
}

Session.prototype._getSshConnInfo = function() {
  var connInfo = {
    host: this._host,
    username: this._auth.username,
    readyTimeout: 60000
  };

  if(this._auth.pem) {
    connInfo.privateKey = this._auth.pem;
  } else {
    connInfo.password = this._auth.password;
  }

  _.extend(connInfo, this._options.ssh);
  return connInfo;
};

Session.prototype._withSshClient = function(callback) {
  if(this._keepAlive) {
    if(!this._keepAliveClient) {
      this._keepAliveClient = new SSHClient();
      this._keepAliveClient.connect(this._getSshConnInfo());
    }

    callback(this._keepAliveClient, function() {});
  } else {
    var client = new SSHClient();
    client.connect(this._getSshConnInfo());
    callback(client, done);

    function done() {
      client.close();
    }
  }
};

Session.prototype.copy = function(src, dest, options, callback) {
  if(typeof(options) == 'function') {
    callback = options;
    options = {};
  }
  options = options || {};

  callback = callback || function() {};

  var self = this;
  var copyFile = src;

  this._debug('copy file - src: %s, dest: %s, vars: %j', src, dest, options.vars);

  //lets do templating
  if(options.vars) {
    self._applyTemplate(src, options.vars, function(err, content) {
      if(err) {
        callback(err);
      } else {
        self._withSshClient(putContent(content));
      }
    });
  } else {
    self._withSshClient(putFile(copyFile));
  }

  function putContent(content) {
    return function(client, done) {
      client.putContent(content, dest, function(err) {
        done();
        (err)? callback(err) : callback(null, 0, {});
      })
    };
  }

  function putFile(copyFile) {
    var putFileOptions = {};

    if(options.progressBar && process.stdout.isTTY) {
      var bar = new ProgressBar("[:bar] :percent :etas", {
        complete: "=",
        incomplete: ' ',
        width: 40,
        total: 100,
        clear: true
      });

      putFileOptions.onProgress = function (completedPercentage) {
        bar.update(completedPercentage / 100);
      };
    }
    else {
      putFileOptions.onProgress = function () {};
    }

    return function(client, done) {
      client.putFile(copyFile, dest, putFileOptions, function(err) {
        done();
        (err)? callback(err) : callback(null, 0, {});
      })
    };
  }
};

Session.prototype.execute = function(shellCommand, options, callback) {
  if(typeof(options) == 'function') {
    callback = options;
    options = {};
  }
  options = options || {};
  callback = callback || function() {};

  this._withSshClient(function(client, done) {
    client.execute(shellCommand, options, function(err, context) {
      done();
      if(err) {
        callback(err);
      } else {
        callback(null, context.code, context);
      }
    });
  });
};

Session.prototype.executeScript = function(scriptFile, options, callback) {
  if(typeof(options) == 'function') {
    callback = options;
    options = {};
  }
  callback = callback || function() {};
  options = options || {};
  options.vars = options.vars || {};


  var self = this;

  this._applyTemplate(scriptFile, options.vars, function(err, content) {
    if(err) {
      callback(err);
    } else {
      self.execute(content, options, callback);
    }
  });
};

Session.prototype._applyTemplate = function(file, vars, callback) {
  var self = this;
  fs.readFile(file, {encoding: 'utf8'}, function(err, content) {
    if(err) {
      callback(err);
    } else {
      if(vars) {
        var ejsOptions = self._options.ejs || {};
        var content = ejs.render(content, vars, ejsOptions);
      }
      callback(null, content);
    }
  });
};

Session.prototype.close = function() {
  if(this._keepAliveClient) {
    this._keepAliveClient.close();
  }
};

module.exports = Session;
