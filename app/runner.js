var cp = Promise.promisifyAll(require('child_process'), {
	multiArgs: true
});
var fs = Promise.promisifyAll(require('fs-extra'));
var temp = Promise.promisifyAll(require('temp')).track();
var path = require('path');

var languages = {
	'.cpp': 'g++ -O2 -static -s -lm -o code [file]',
	'.pas': 'fpc -O2 -ocode [file]'
};

var verdicts = {
	'RE': 'Runtime Error',
	'SG': 'Code killed with Fatal Signal 11',
	'AC': 'Accepted',
	'WA': 'Wrong Answer'
};

/**
 * execAsync with stderr on Error
 */
function executeAsync(cmd, options) {
	options = options || {};
	return new Promise(function(resolve, reject) {
		cp.exec(cmd, options, function(err, stdout, stderr) {
			if (err && !options.ignoreExitcode) reject(new Error(stderr));
			else resolve([stdout, stderr]);
		});
	});
}

/**
 * Compiles the given code
 * @param {String} file The file to be compiled
 * @return {Promise<Buffer / Error>} The buffer of the compiled file, or an error
 *                           		 if compilation fails
 */
function Compile(file) {
	return temp.mkdirAsync('')
		.then(function(dir) {
			return executeAsync(languages[path.extname(file)].replace('[file]', file), {
				cwd: dir
			})
			.then(function() {
				return fs.readFileAsync(path.join(dir, 'code'));
			});
		});
}

/**
 * Evaluates the code on the given testcase
 * @param {Object} options The obtions Object
 *  @param {Buffer} file   The binary code file to execute
 *  @param {String} input  The input file to act as stdin
 *  @param {String} output The output file to compare with
 *  @param [String] checker The checker file to run, or `false` for diff
 *  @param {Number} timeLimit The time limit, in miliseconds
 *  @param {Number} memoryLimit The memory limit, in kilobytes
 * @return {Promise<Object>} The result object
 */
function Evaluate(options) {
	var boxdir;
	var ret = executeAsync('isolate --init --cg')
			.then(function(std) {
				// Get working folder from isolate
				var [stdout, stderr] = std;
				boxdir = path.join(stdout.replace('\n', ''), 'box');
			})
			.then(function() {
				// Copy evaluation files into isolate's folder
				return Promise.all([
					fs.writeFileAsync(path.join(boxdir, 'code'), options.code),
					fs.copyAsync(options.input, path.join(boxdir, 'input.txt'))
				]);
			})
			.then(function() {
				return Promise.all([
					fs.chmodAsync(path.join(boxdir, 'code'), '755')
				]);
			})
			.then(function() {
				// Runs the code in isolate
				return executeAsync('isolate --run --cg' +
									' -M ' + path.join(boxdir, '__meta.txt') +
									' -t ' + (options.timeLimit / 1000) +
									' -w ' + (2 * options.timeLimit / 1000) +
									' -x 1 ' +
									' -k 262144' +
									' -m ' + options.memoryLimit +
									' -i input.txt' +
									' -o output.txt' + ' code', {
										ignoreExitcode: true
									});
			})
			.then(function() {
				// Reads the meta file and get information
				return fs.readFileAsync(path.join(boxdir, '__meta.txt'), 'utf8')
					.then(function(content) {
						var opt = {};
						content.split('\n').forEach(function(line) {
							var [name, val] = line.split(':');
							opt[name] = val;
						});
						return opt;
					});
			}).then(function(opt) {
				// If the file runs ok, pass it to diff
				// Else just return information
				var ret = {
					runningTime: Number(opt.time) * 1000,
					memoryUsed: Number(opt['cg-mem'])
				};
				if (opt.status) {
					ret.signal = opt.status;
					ret.verdict = verdicts[opt.status] || opt.message;
					return ret;
				}
				// Use diff
				if (options.checker === false)
					return executeAsync('diff -wi ' + options.output + ' ' + path.join(boxdir, 'output.txt'))
						.then(function() {
							ret.signal = 'AC';
							ret.verdict = verdicts.AC;
						})
						.catch(function() {
							ret.signal = 'WA';
							ret.verdict = verdicts.WA;
						})
						.then(function() {
							return ret;
						});
				// Use checker
				else
					return executeAsync(options.checker +
										' ' + options.input +
										' ' + path.join(boxdir, 'output.txt') +
										' ' + options.output)
						.then(function(streams) {
							var [stdout, stderr] = streams;
							ret.signal = 'AC';
							ret.verdict = (stderr ? stderr.replace('\n', '') : verdicts.AC);
						}).catch(function(stderr) {
							ret.signal = 'WA';
							ret.verdict = (stderr ? stderr.replace('\n', '') : verdicts.WA);
						})
						.then(function() {
							return ret;
						});
			})
	.then(function(data) {
		return executeAsync('isolate --cleanup', { ignoreExitcode: true }).then(function() {
			return data;
		});
	});
	return ret;
}

try {
	if (!cp.execSync('isolate --init').error) {
		console.log('isolate sandbox loaded');
	}
} catch (e) {
	throw new Error('isolate not installed / configured!');
}

module.exports = {
	Compile: Compile,
	Evaluate: Evaluate
};
