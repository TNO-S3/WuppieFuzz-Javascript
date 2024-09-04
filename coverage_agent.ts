
// Coverage server

import {Buffer} from 'buffer/';

const JACOCO_HEADER = [0xc0, 0xc0];
// const RAW_HEADER = [0xc1, 0x0];
const RAW_HEADER = new Uint8Array([0xc1, 0xc0]);
const REQUEST_HEADER = [0x01, 0xc0, 0xc0, 0x10, 0x07];
const BLOCK_CMD_DUMP = 0x40;
const FORMAT_VERSION = new Uint8Array([0x10, 0x07]);
const BlockType = {
  Header: 0x01,
  SessionInfo: 0x10,
  CoverageInfo: 0x11,
  CmdOk: 0x20,
  CmdDump: 0x40,
}

function concatUInt8Arrays(a1, a2) {
  // sum of individual array lengths
  let mergedArray = new Uint8Array(a1.length + a2.length);
  mergedArray.set(a1);
  mergedArray.set(a2, a1.length);
  return mergedArray;
}

class Block {
  block_type: any;
  block_data: any;
  constructor(block_type, block_data) {
    this.block_type = block_type;
    this.block_data = block_data;
  }

  to_buffer() {
    let buf
    if (this.block_type == BlockType.CoverageInfo) {
      buf = Buffer.alloc(1 + 4 + this.block_data.length)
      buf.writeUInt32LE(this.block_data.length, 1);
      buf.fill(this.block_data, 5);
    } else if (this.block_type == BlockType.Header) {
      buf = Buffer.alloc(1 + RAW_HEADER.length + FORMAT_VERSION.length);
      buf.fill(this.block_data, 1);
    }
    buf[0] = this.block_type;
    return buf;
  }
}

const runtimeCoverage = require('runtime-coverage');
const COVERAGE_PORT = 3001;
let coverage_started = false;

let net = require('net');
const { resolve } = require("path");
const { binary } = require('@hapi/joi');


let server = net.createServer();

server.on('connection', function(socket) {
  console.log('Coverage connection established.');

  // The server can also receive data from the client by reading from its socket.
  socket.on('data', async function(buf) {
    // buf.subarray(0, 5) = REQUEST_HEADER, unused by us for the time being.
    // buf[5] = command, we only send BLOCK_CMD_DUMP, so this is ignored.
    // buf[6] = boolean that indicates whether or not to retrieve coverage (ignore).
    // Read RESET PARAMETER
    let reset_byte = buf[7];
    if (reset_byte == 0) {
      console.log("Warning: coverage agent does not support getting coverage without reset.");
    }
    let reset = true;
    // Fetch and return coverage data
    if (coverage_started) {
      let cov_data = await get_coverage();
      if (cov_data != null) {
        let header_data = concatUInt8Arrays(RAW_HEADER, FORMAT_VERSION);
        // let header_data = new Uint8Array([...RAW_HEADER, ...FORMAT_VERSION]);
        let header_block = new Block(BlockType.Header, header_data);
        let header_block_buf = header_block.to_buffer();
        socket.write(header_block_buf);
        let coverage_block = new Block(BlockType.CoverageInfo, cov_data)
        let cov_block_buf = coverage_block.to_buffer();
        socket.write(cov_block_buf);
      }
    }
    if (reset) {
      await start_coverage();
    }
    socket.write(Buffer.from([BlockType.CmdOk]));
  });

  // When the client requests to end the TCP connection with the server, the server
  // ends the connection.
  socket.on('end', function() {
    console.log('Closing connection with the client');
  });

  socket.on('error', function(err) {
    console.log(`Error: ${err}`);
  });
});

server.listen(COVERAGE_PORT, '127.0.0.1', function() {
  console.log(`Coverage agent listening on port ${COVERAGE_PORT}`)
});

async function start_coverage() {
  if (!coverage_started) {
    runtimeCoverage.startCoverage();
    coverage_started = true;
  }
}

// Return binary-encoded coverage information
async function get_coverage() {
  const options = {
    all: true,
    return: true,
    reporters: ['lcovonly'],
  };
  coverage_started = false;  // runtime-coverage automatically reset every time you get coverage
  let coverage_promise = runtimeCoverage.getCoverage(options)
  .then((response) => response)
  .catch(error => {
    console.log(error.message);
    start_coverage();
    return "coverage not started";
  });
  let coverage = await coverage_promise;
  if (coverage === "coverage not started") {
    return null;
  }
  return coverage["lcovonly"];
}
