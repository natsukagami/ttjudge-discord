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
			.then(() => {
				// Let's convert the problem's metadata a little so that it matches
				// kjudge-api's requirements
				return Promise.all([
					(!this.checker ? Promise.resolve('') : fs.readFileAsync(this.checker, 'utf8')),
					(!this.header  ? Promise.resolve('') : fs.readFileAsync(this.header , 'utf8')),
					(!this.grader  ? Promise.resolve('') : fs.readFileAsync(this.grader , 'utf8'))
				]).then((reads) => {
					if (this.scoreType === 'oi' || this.scoreType === 'acm') {
						this.score = 100;
						// Old type detected
						this.scoreType = (this.scoreType === 'oi' ? 'single' : 'subtaskMin');
						this.testInfo = this.testcases.map((item, idx) => {
							return new kjudge.Test(
								idx,
								item[0],
								item[1],
								this.timeLimit,
								this.memoryLimit,
								this.score / this.testcases.length,
								0
							);
						});
					}
					this.Problem = new kjudge.Problem(
						this.name,
						this.submitType,
						this.scoreType,
						reads[0],
						reads[1],
						reads[2]
					);
					this.testInfo.forEach((item) => { this.Problem.pushTest(item); });
					this.name = this.name.toUpperCase();
				});
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
		this.header = (config.HEADER ? path.join(this.directory, config.HEADER) : false);
		this.grader = (config.GRADER ? path.join(this.directory, config.GRADER): false);
		this.testInfo = (config.TESTS ? config.TESTS : false);
		/**
		 * Some notes about the scoreType now
		 * Simple as it was, the result was not enough. This time, we provide a much better scoring
		 * module. The tests now come with a "subtask" option, which brings us to just 3 types of
		 * scores:
		 *  - single: For this scoring type, subtasks are not considered for scores. Each test should have
		 *  its own score, and points are awarded for each (partially or fully) correct test. This is
		 *  familiar to the old "oi" type, and all old "oi" type problems will be converted to this type.
		 *  - subtaskMin: Subtasks have their meaning now. For each test, the grader should return a number
		 *  between 0.0 and 1.0, which will be considered the "subtask ratio". A subtask's ratio is the
		 *  MINIMUM ratio scored for each test in the subtask. The subtask's score is then calculated by
		 *  multiplying the subtask ratio with the sum of all tests' possible scores. If the ratio is only
		 *  0 or 1, and there's only one subtask, it should sound just like the old "acm" scoring module.
		 *  - subtaskMul: This scoring type is just similar to subtaskMin, however the ratio, rather than being
		 *  the MINIMUM, becomes the PRODUCT of all tests' ratios. This way, multiple partially scored tests
		 *  affects the subtask's score even more.
		 */
		this.scoreType = config.SCORE_TYPE;
		this.submitType = (config.SUBMIT_TYPE ? config.SUBMIT_TYPE : 'single');
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
						if (stats.isFile()) inst.testcases.push([inpath, outpath]);
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
