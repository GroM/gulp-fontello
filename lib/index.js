/**
 * Created by gillbeits on 01/04/15.
 */

var
	HOST        = 'http://fontello.com',

	fs          = require('fs'),
	crypto      = require('crypto'),
	needle      = require('needle'),
	through2    = require('through2'),
	AdmZip      = require('adm-zip'),
	path        = require('path'),
	Vinyl       = require('vinyl'),
	log         = require('fancy-log'),
	yargs       = require('yargs'),
	extend      = require('util')._extend,

	PluginError = require('gulp-error')
	;

const PLUGIN_NAME = 'gulp-fontello';

function fontello (opts) {
	"use strict";

	opts = extend({
		assetsOnly: true,
		host: HOST,
		preprocess: false,
		font: 'font/',
		css: 'css/',
		scss: 'scss/',
		fontClass: false,
	}, extend(opts || {}, yargs.argv));



	return through2.obj(function (file, enc, callback) {
		var self = this;
		var replacePathScss = (opts['preprocess'] && opts['preprocess'] == 'scss');
		var replacePathCss = (opts['font'] && opts['font'] != 'font/');
		var replacePath =  replacePathScss || replacePathCss;
		var rpl = (replacePathScss) ? { s: new RegExp('\'\\.\\.\\/font\\/', 'g'), d: '$fontelloPath + \''} : (replacePathCss ? {s: new RegExp('\\.\\.\\/font\\/', 'g'), d: opts['font']} : {s: false, d: false});
		var addFontClass = opts.fontClass ? {s: new RegExp('\\[class\\^=', 'g'), d: '.'.concat(opts.fontClass, ', $&'), } : {s: false, d: false};

		var processResponse = function (zipContents, callback) {
			var
				zip = new AdmZip(zipContents),
				zipEntries = zip.getEntries(),
				finalFontDir = opts['font'];

			zipEntries.forEach(function (zipEntry) {
				var dirName, fileName, pathName, _ref, fileExt, finalDirName;

				if (zipEntry.isDirectory) return;

				pathName = zipEntry.entryName;
				dirName = (_ref = path.dirname(pathName).match(/\/([^\/]*)$/)) != null ? _ref[1] : void 0;
				fileName = path.basename(pathName);

				if (opts.assetsOnly && !dirName) return;
				var content = zipEntry.getData();
				fileExt = path.extname(fileName);
				finalDirName = opts[dirName];
				if(fileExt == '.css')
				{
					var contentString = String(content);
					var modified = false;
					if(rpl.s)
					{
						contentString = contentString.replace(rpl.s, rpl.d);
						modified = true;
					}
					if(opts['preprocess'])
					{
						switch(opts['preprocess'])
						{
							case 'scss':
								fileName = '_' + fileName.replace(/\.css$/, '.scss');
								if(addFontClass.s)
								{
									contentString = contentString.replace(addFontClass.s, addFontClass.d);
								}
								contentString = "$fontelloPath: '".concat(finalFontDir, "' !default;\n", contentString);
								modified = true;
								break;
							default:
								throw new Exception('Invalid preprocess value');
						}
						finalDirName = opts[opts['preprocess']];
					}
					if(modified)
					{
						content = Buffer.from(contentString);
					}

				}

				var file = new Vinyl({
					cwd: "./",
					path: finalDirName + fileName,
					contents: content
				});
				console.log(file);
				self.push(file);
			});

			callback();
		};

		var fetchFromHost = function (callback) {
			var stream = through2.obj(function (file) {
				if (!file.toString()) {
					callback(new PluginError(PLUGIN_NAME, "No session at Fontello for zip archive"));
					return;
				}

				var reqOpts = {};
				if (process.env.HTTP_PROXY) {
					reqOpts.proxy = process.env.HTTP_PROXY;
				}
				needle.get(opts.host + "/" + file.toString() + "/get", reqOpts, function (error, response) {
					if (error) {
						callback(error);
					}

					// store in cache if configured
					if (opts.cache) {
						opts.cache.set(configHash, response.body);
					}

					processResponse(response.body, callback);
				});
			});

			var reqOpts = { multipart: true };
			if (process.env.HTTP_PROXY) {
				reqOpts.proxy = process.env.HTTP_PROXY;
			}
			needle.post(opts.host, {
				config: {
					buffer: file.contents,
					filename: 'fontello.json',
					content_type: 'application/json'
				}
			}, reqOpts).on('err', callback).pipe(stream);
		};

		// create SHA256 of the contents of the config file
		var configHash = crypto.createHash('sha256').update(file.contents).digest('hex');

		// use cache if configured
		if (opts.cache) {
			// check cache first
			opts.cache.get(configHash, function (error, cachedResponseBody) {
				// on cache err or empty response use normal fetch
				if (error || !cachedResponseBody) {
					fetchFromHost(callback);
				} else {
					log('using cached fontello zip for config with sha1: ' + configHash);
					processResponse(cachedResponseBody, callback);
				}
			});
		} else {
			fetchFromHost(callback);
		}
	});
}

/**
 * simple file-system based cache
 *
 * @param cacheDir
 * @returns {{get: 'get', set: 'set'}}
 */
fontello.simpleFsCache = function(cacheDir) {
	if (!fs.lstatSync(cacheDir).isDirectory()) {
		fs.mkdirSync(cacheDir);
	}

	return {
		'get': function(file, cb) {
			fs.readFile(path.join(cacheDir, file + ".cached.zip"), function(err, result) {
				if (err || !result) {
					cb();
				} else {
					cb(null, result);
				}
			});
		},
		'set': function(file, response) {
			fs.writeFile(path.join(cacheDir, file + ".cached.zip"), response, function noop() {});
		}
	}
};

module.exports = fontello;
