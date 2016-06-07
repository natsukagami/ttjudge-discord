var fs = Promise.promisifyAll(require('fs-extra'));
fs.walk = require('walk').walk;
var path = require('path');
var md = require('markdown-creator');

module.exports = function(app) {
	/**
	 * Class Problem
	 * @param    {String}  directory The directory to the problem
	 * @property {boolean} ready     Indicates if the problem is ready to be used
	 * @property {Array<Array<String, 2> >} testcases The list of testcases
	 * @property {Number} timeLimit  In miliseconds
	 * @property {Number} memoryLimit In kilobytes
	 */
	function Problem(directory, name) {
		// Problem parsed?
		this.ready = false;
		this.directory = directory;
		this.name = name;
		var inst = this;
		this._readyPromise = fs.readFileAsync(path.join(directory, 'problem.json'))
			.then(function(config) {
				inst._parseConfig(config);
			})
			.then(function() {
				return inst._parseTests();
			})
			.then(function() {
				inst.ready = true;
			})
			.catch(function(err) {
				console.log(err);
				this.ready = false;
			});
	}
	/**
	 * Parses the problem.json file
	 * @param  {String} config The configuration string read from file
	 */
	Problem.prototype._parseConfig = function(config) {
		config = JSON.parse(config);
		this.timeLimit = config.TIMEOUT;
		this.memoryLimit = config.MEMLIMIT;
		this.checker = (config.CHECKER ? path.join(this.directory, config.CHECKER_FILE) : false);
		this.scoreType = config.SCORE_TYPE;
		this.score = config.SCORE;
		this.inputMatch = config.INPUT_MATCH;
		this.outputMatch = config.OUTPUT_MATCH;
	};
	/**
	 * Parse all testcases of the problem
	 * @return {Promise<>} The promise of the process
	 */
	Problem.prototype._parseTests = function() {
		this.testcases = []; var inst = this;
		var inputRegex = new RegExp(this.inputMatch);
		var walker = fs.walk(this.directory, {
			followLinks: true
		});
		walker.on('file', function(root, stats, next) {
			var inpath = path.relative(inst.directory, path.join(root, stats.name));
			if (inputRegex.test(inpath)) {
				var outpath = inpath.replace(inputRegex, inst.outputMatch);
				fs.statAsync(path.join(inst.directory, outpath))
					.then(function(stats) {
						if (stats.isFile()) inst.testcases.push([path.join(inst.directory, inpath), path.join(inst.directory, outpath)]);
					})
					.catch(function(err) {
						// Pass
					})
					.finally(next);
			} else next();
		});
		return new Promise(function(resolve) {
			walker.once('end', function() {
				inst.testcases.sort();
				resolve();
			});
		});
	};
	/**
	 * Promise of readiness
	 * @return {Promise<>}
	 */
	Problem.prototype.onReady = function() {
		return this._readyPromise;
	};

	Problem.prototype.getTitle = function() {
		return 'Problem ' + md.bold(this.name) + ' | Time Limit: ' + md.bold(this.timeLimit + '') + 'ms | Memory Limit: ' + md.bold(' ' + this.memoryLimit) + 'KBs';
	};
	return Problem;
};
