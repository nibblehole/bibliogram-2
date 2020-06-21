const fs = require("fs")
const fsp = fs.promises
const pj = require("path").join
const {promisify} = require("util")
const crypto = require("crypto")
const stream = require("stream")

const db = require("../../db")
const Saved = require("../request_backends/saved")
const NodeFetch = require("../request_backends/node-fetch")
require("../../testimports")(db, Saved)

const folder = __dirname + "/files"

function generateName() {
	return crypto.randomBytes(20).toString("hex")
}

class DelayedBackend {
	constructor(waiter) {
		this.waiter = waiter
	}

	stream() {
		return this.waiter.then(instance => instance.stream())
	}

	response() {
		return this.waiter.then(instance => instance.response())
	}

	json() {
		return this.waiter.then(instance => instance.json())
	}

	text() {
		return this.waiter.then(instance => instance.text())
	}

	check(test) {
		return this.waiter.then(instance => instance.check(test))
	}
}

class SavedRequestManager {
	constructor(url, options) {
		this.url = url.toString()
		this.options = options
		// console.log(this.url, this.options)
	}

	clone() {
		return new SavedRequestManager(this.url, this.options)
	}

	request() {
		const row = db.prepare("SELECT * FROM SavedRequests WHERE url = ?").get(this.url)
		if (row) {
			console.log("Found, using saved request for "+row.path)
			const base = pj(folder, row.path)
			return new Saved(base)
		} else {
			const name = generateName()
			console.log("Not found, saving now as "+name)

			const internalRequest = new NodeFetch(this.url)
			return new DelayedBackend(
				Promise.all([
					internalRequest.instance.then(instance => {
						return fsp.writeFile(pj(folder, name + ".meta.json"), JSON.stringify({
							status: instance.status,
							headers: instance.headers.raw()
						}, null, 4))
					}),
					internalRequest.stream().then(readable => {
						return promisify(stream.pipeline)(
							readable,
							fs.createWriteStream(pj(folder, name))
						)
					})
				]).then(() => {
					// console.log("Pipeline complete, writing database")
					db.prepare("REPLACE INTO SavedRequests (url, path) VALUES (?, ?)").run(this.url, name)
					return this.clone().request()
				})
			)
		}
	}
}

module.exports = SavedRequestManager
