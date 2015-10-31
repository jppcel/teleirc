var Telegram = require('node-telegram-bot-api');
var fs = require('fs');
var path = require('path');
var irc = require('./irc');
var nodeStatic = require('node-static');
var mkdirp = require('mkdirp');

// tries to read chat ids from a file
var readChatIds = function(arr) {
    console.log('\n');
    console.log('NOTE!');
    console.log('=====');

    var idMissing = false;
    try {
        var json = JSON.parse(fs.readFileSync(process.env.HOME + '/.teleirc/chat_ids'));
        for (var i = 0; i < arr.length; i++) {
            var key = arr[i].tgGroup;
            if (key in json) {
                arr[i].tgChatId = json[key];
                console.log('id found for:', key, ':', json[key]);
            } else {
                console.log('id not found:', key);
                idMissing = true;
            }
        }
    } catch (e) {
        console.log('~/.teleirc/chat_ids file not found!');
        idMissing = true;
    }

    if (idMissing) {
        console.log(
            '\nPlease add your Telegram bot to a Telegram group and have' +
            '\nsomeone send a message to that group.' +
            '\nteleirc will then automatically store your group chat_id.');
    }

    console.log('\n');
};

var writeChatIds = function(config) {
    var json = {};
    for (var i = 0; i < config.channels.length; i++) {
        if (config.channels[i].tgChatId) {
            json[config.channels[i].tgGroup] = config.channels[i].tgChatId;
        }
    }
    json = JSON.stringify(json);
    fs.writeFile(process.env.HOME + '/.teleirc/chat_ids', json, function(err) {
        if (err) {
            console.log('error while storing chat ID:');
            console.log(err);
        } else {
            console.log('successfully stored chat ID in ~/.teleirc/chat_ids');
        }
    });
};

var getName = function(user, config) {
    var name = config.nameFormat;

    // Check if in the config.nameFormat has firstName or lastName yet
    // to dont show the names two times, if needed
    var hasFirstName = name.replace('%firstName%', true, 'g');
    var hasLastName = name.replace('%lastName%', true, 'g');

    if (user.username) {
        name = name.replace('%username%', user.username, 'g');
    } else {
        // This will be execute if the user don't have username
        // if user use firstName or lastName yet, only show 'No username'
        if (hasFirstName || hasLastName) {
            // Display only 'No username' if use it
            name = name.replace('%username%', 'No username', 'g');
        } else {
            // Display fallback format string
            name = name.replace('%username%', config.usernameFallbackFormat, 'g');
        }
    }

    name = name.replace('%firstName%', user.first_name, 'g');
    name = name.replace('%lastName%', user.last_name, 'g');

    return name;
};

var serveFile = function(fileId, config, tg, callback) {
    tg.downloadFile(fileId, process.env.HOME + '/.teleirc/files').then(function(filePath) {
        callback(config.httpLocation + '/' + path.basename(filePath));
    });
};

module.exports = function(config, sendTo) {
    // start HTTP server for media files if configured to do so
    if (config.showMedia) {
        var fileServer = new nodeStatic.Server(process.env.HOME + '/.teleirc/files');
        mkdirp(process.env.HOME + '/.teleirc/files');

        require('http').createServer(function(req, res) {
            req.addListener('end', function() {
                fileServer.serve(req, res);
            }).resume();
        }).listen(config.httpPort);
    }

    var tg = new Telegram(config.tgToken, {polling: true});

    readChatIds(config.channels);

    tg.on('message', function(msg) {
        var channel = config.channels.filter(function(channel) {
            return channel.tgGroup === msg.chat.title;
        })[0];

        if (!channel) {
            return;
        }

        if (!channel.tgChatId) {
            console.log('storing chat ID: ' + msg.chat.id);
            channel.tgChatId = msg.chat.id;
            writeChatIds(config);
        }

        // skip posts containing media if it's configured off
        if ((msg.audio || msg.document || msg.photo || msg.sticker || msg.video ||
            msg.voice || msg.contact || msg.location) && !config.showMedia) {
            return;
        }

        if (msg.reply_to_message && msg.text) {
            sendTo.irc(channel.ircChan, '<' + getName(msg.from, config) + '>: ' +
                '@' + getName(msg.reply_to_message.from, config) + ', ' + msg.text);
        } else if (msg.audio) {
            sendTo.irc(channel.ircChan, '<' + getName(msg.from, config) + '>: ' +
                '(Audio)');
        } else if (msg.document) {
            sendTo.irc(channel.ircChan, '<' + getName(msg.from, config) + '>: ' +
                '(Document)');
        } else if (msg.photo) {
            // pick the highest quality photo
            var photo = msg.photo[msg.photo.length - 1];

            serveFile(photo.file_id, config, tg, function(url) {
                sendTo.irc(channel.ircChan, '<' + getName(msg.from, config) + '>: ' +
                    '(Photo, ' + photo.width + 'x' + photo.height + ') ' + url);
            });
        } else if (msg.sticker) {
            serveFile(msg.sticker.file_id, config, tg, function(url) {
                sendTo.irc(channel.ircChan, '<' + getName(msg.from, config) + '>: ' +
                    '(Sticker, ' + msg.sticker.width + 'x' + msg.sticker.height + ') ' + url);
            });
        } else if (msg.video) {
            sendTo.irc(channel.ircChan, '<' + getName(msg.from, config) + '>: ' +
                '(Video, ' + msg.video.duration + 's)');
        } else if (msg.voice) {
            sendTo.irc(channel.ircChan, '<' + getName(msg.from, config) + '>: ' +
                '(Voice, ' + msg.audio.duration + 's)');
        } else if (msg.contact) {
            sendTo.irc(channel.ircChan, '<' + getName(msg.from, config) + '>: ' +
                '(Contact, ' + '"' + msg.contact.first_name + ' ' +
                msg.contact.last_name + '", ' +
                msg.contact.phone_number + ')');
        } else if (msg.location) {
            sendTo.irc(channel.ircChan, '<' + getName(msg.from, config) + '>: ' +
                '(Location, ' + 'lon: ' + msg.location.longitude +
                              ', lat: ' + msg.location.latitude + ')');
        } else if (msg.new_chat_participant) {
            sendTo.irc(channel.ircChan, getName(msg.new_chat_participant, config) +
                ' was added by: ' + getName(msg.from, config));
        } else if (msg.left_chat_participant) {
            sendTo.irc(channel.ircChan, getName(msg.left_chat_participant, config) +
                ' was removed by: ' + getName(msg.from, config));
        } else {
            sendTo.irc(channel.ircChan, '<' + getName(msg.from, config) + '>: ' + msg.text);
        }
    });

    sendTo.tg = function(channel, msg) {
        console.log('  >> relaying to TG: ' + msg);

        if (!channel.tgChatId) {
            var err = 'ERROR: No chat_id set! Add me to a Telegram group ' +
                      'and say hi so I can find your group\'s chat_id!';
            sendTo.irc(channel.ircChan, err);
            console.error(err);
            return;
        }

        tg.sendMessage(channel.tgChatId, msg);
    };
};
