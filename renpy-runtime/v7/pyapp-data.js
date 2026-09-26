
  var Module = typeof Module !== 'undefined' ? Module : {};
  
  if (!Module.expectedDataFileDownloads) {
    Module.expectedDataFileDownloads = 0;
  }
  Module.expectedDataFileDownloads++;
  (function() {
   var loadPackage = function(metadata) {
  
      var PACKAGE_PATH;
      if (typeof window === 'object') {
        PACKAGE_PATH = window['encodeURIComponent'](window.location.pathname.toString().substring(0, window.location.pathname.toString().lastIndexOf('/')) + '/');
      } else if (typeof location !== 'undefined') {
        // worker
        PACKAGE_PATH = encodeURIComponent(location.pathname.toString().substring(0, location.pathname.toString().lastIndexOf('/')) + '/');
      } else {
        throw 'using preloaded data can only be done on a web page or in a web worker';
      }
      var PACKAGE_NAME = 'pyapp.data';
      var REMOTE_PACKAGE_BASE = 'pyapp.data';
      if (typeof Module['locateFilePackage'] === 'function' && !Module['locateFile']) {
        Module['locateFile'] = Module['locateFilePackage'];
        err('warning: you defined Module.locateFilePackage, that has been renamed to Module.locateFile (using your locateFilePackage for now)');
      }
      var REMOTE_PACKAGE_NAME = Module['locateFile'] ? Module['locateFile'](REMOTE_PACKAGE_BASE, '') : REMOTE_PACKAGE_BASE;
    
      var REMOTE_PACKAGE_SIZE = metadata['remote_package_size'];
      var PACKAGE_UUID = metadata['package_uuid'];
    
      function fetchRemotePackage(packageName, packageSize, callback, errback) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', packageName, true);
        xhr.responseType = 'arraybuffer';
        xhr.onprogress = function(event) {
          var url = packageName;
          var size = packageSize;
          if (event.total) size = event.total;
          if (event.loaded) {
            if (!xhr.addedTotal) {
              xhr.addedTotal = true;
              if (!Module.dataFileDownloads) Module.dataFileDownloads = {};
              Module.dataFileDownloads[url] = {
                loaded: event.loaded,
                total: size
              };
            } else {
              Module.dataFileDownloads[url].loaded = event.loaded;
            }
            var total = 0;
            var loaded = 0;
            var num = 0;
            for (var download in Module.dataFileDownloads) {
            var data = Module.dataFileDownloads[download];
              total += data.total;
              loaded += data.loaded;
              num++;
            }
            total = Math.ceil(total * Module.expectedDataFileDownloads/num);
            if (Module['setStatus']) Module['setStatus']('Downloading data... (' + loaded + '/' + total + ')');
          } else if (!Module.dataFileDownloads) {
            if (Module['setStatus']) Module['setStatus']('Downloading data...');
          }
        };
        xhr.onerror = function(event) {
          throw new Error("NetworkError for: " + packageName);
        }
        xhr.onload = function(event) {
          if (xhr.status == 200 || xhr.status == 304 || xhr.status == 206 || (xhr.status == 0 && xhr.response)) { // file URLs can return 0
            var packageData = xhr.response;
            callback(packageData);
          } else {
            throw new Error(xhr.statusText + " : " + xhr.responseURL);
          }
        };
        xhr.send(null);
      };

      function handleError(error) {
        console.error('package error:', error);
      };
    
    function runWithFS() {
  
      function assert(check, msg) {
        if (!check) throw msg + new Error().stack;
      }
  Module['FS_createPath']("/", "_dummy_thread", true, true);
Module['FS_createPath']("/", "http", true, true);
Module['FS_createPath']("/", "xmlrpc", true, true);
Module['FS_createPath']("/", "_thread", true, true);
Module['FS_createPath']("/", "libpasteurize", true, true);
Module['FS_createPath']("/libpasteurize", "fixes", true, true);
Module['FS_createPath']("/", "six-1.12.0.dist-info", true, true);
Module['FS_createPath']("/", "socketserver", true, true);
Module['FS_createPath']("/", "past", true, true);
Module['FS_createPath']("/past", "builtins", true, true);
Module['FS_createPath']("/past", "types", true, true);
Module['FS_createPath']("/past", "utils", true, true);
Module['FS_createPath']("/past", "translation", true, true);
Module['FS_createPath']("/", "builtins", true, true);
Module['FS_createPath']("/", "libfuturize", true, true);
Module['FS_createPath']("/libfuturize", "fixes", true, true);
Module['FS_createPath']("/", "bin", true, true);
Module['FS_createPath']("/", "ecdsa-0.18.0.dist-info", true, true);
Module['FS_createPath']("/", "html", true, true);
Module['FS_createPath']("/", "ecdsa", true, true);
Module['FS_createPath']("/", "lib", true, true);
Module['FS_createPath']("/lib", "python2.7", true, true);
Module['FS_createPath']("/lib/python2.7", "site-packages", true, true);
Module['FS_createPath']("/lib/python2.7/site-packages", "pygame_sdl2", true, true);
Module['FS_createPath']("/lib/python2.7/site-packages/pygame_sdl2", "threads", true, true);
Module['FS_createPath']("/", "_markupbase", true, true);
Module['FS_createPath']("/", "future-0.18.2.dist-info", true, true);
Module['FS_createPath']("/", "future", true, true);
Module['FS_createPath']("/future", "builtins", true, true);
Module['FS_createPath']("/future", "backports", true, true);
Module['FS_createPath']("/future/backports", "http", true, true);
Module['FS_createPath']("/future/backports", "xmlrpc", true, true);
Module['FS_createPath']("/future/backports", "html", true, true);
Module['FS_createPath']("/future/backports", "email", true, true);
Module['FS_createPath']("/future/backports/email", "mime", true, true);
Module['FS_createPath']("/future/backports", "test", true, true);
Module['FS_createPath']("/future/backports", "urllib", true, true);
Module['FS_createPath']("/future", "standard_library", true, true);
Module['FS_createPath']("/future", "tests", true, true);
Module['FS_createPath']("/future", "moves", true, true);
Module['FS_createPath']("/future/moves", "dbm", true, true);
Module['FS_createPath']("/future/moves", "http", true, true);
Module['FS_createPath']("/future/moves", "xmlrpc", true, true);
Module['FS_createPath']("/future/moves", "html", true, true);
Module['FS_createPath']("/future/moves", "test", true, true);
Module['FS_createPath']("/future/moves", "urllib", true, true);
Module['FS_createPath']("/future/moves", "tkinter", true, true);
Module['FS_createPath']("/future", "types", true, true);
Module['FS_createPath']("/future", "utils", true, true);
Module['FS_createPath']("/", "copyreg", true, true);
Module['FS_createPath']("/", "winreg", true, true);
Module['FS_createPath']("/", "typing-3.10.0.0.dist-info", true, true);
Module['FS_createPath']("/", "queue", true, true);
Module['FS_createPath']("/", "tkinter", true, true);
Module['FS_createPath']("/", "reprlib", true, true);

          /** @constructor */
          function DataRequest(start, end, audio) {
            this.start = start;
            this.end = end;
            this.audio = audio;
          }
          DataRequest.prototype = {
            requests: {},
            open: function(mode, name) {
              this.name = name;
              this.requests[name] = this;
              Module['addRunDependency']('fp ' + this.name);
            },
            send: function() {},
            onload: function() {
              var byteArray = this.byteArray.subarray(this.start, this.end);
              this.finish(byteArray);
            },
            finish: function(byteArray) {
              var that = this;
      
          Module['FS_createDataFile'](this.name, null, byteArray, true, true, true); // canOwn this data in the filesystem, it is a slide into the heap that will never change
          Module['removeRunDependency']('fp ' + that.name);
  
              this.requests[this.name] = null;
            }
          };
      
              var files = metadata['files'];
              for (var i = 0; i < files.length; ++i) {
                new DataRequest(files[i]['start'], files[i]['end'], files[i]['audio']).open('GET', files[i]['filename']);
              }
      
        
        var indexedDB;
        if (typeof window === 'object') {
          indexedDB = window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;
        } else if (typeof location !== 'undefined') {
          // worker
          indexedDB = self.indexedDB;
        } else {
          throw 'using IndexedDB to cache data can only be done on a web page or in a web worker';
        }
        var IDB_RO = "readonly";
        var IDB_RW = "readwrite";
        var DB_NAME = "EM_PRELOAD_CACHE";
        var DB_VERSION = 1;
        var METADATA_STORE_NAME = 'METADATA';
        var PACKAGE_STORE_NAME = 'PACKAGES';
        function openDatabase(callback, errback) {
          try {
            var openRequest = indexedDB.open(DB_NAME, DB_VERSION);
          } catch (e) {
            return errback(e);
          }
          openRequest.onupgradeneeded = function(event) {
            var db = event.target.result;

            if(db.objectStoreNames.contains(PACKAGE_STORE_NAME)) {
              db.deleteObjectStore(PACKAGE_STORE_NAME);
            }
            var packages = db.createObjectStore(PACKAGE_STORE_NAME);

            if(db.objectStoreNames.contains(METADATA_STORE_NAME)) {
              db.deleteObjectStore(METADATA_STORE_NAME);
            }
            var metadata = db.createObjectStore(METADATA_STORE_NAME);
          };
          openRequest.onsuccess = function(event) {
            var db = event.target.result;
            callback(db);
          };
          openRequest.onerror = function(error) {
            errback(error);
          };
        };

        // This is needed as chromium has a limit on per-entry files in IndexedDB
        // https://cs.chromium.org/chromium/src/content/renderer/indexed_db/webidbdatabase_impl.cc?type=cs&sq=package:chromium&g=0&l=177
        // https://cs.chromium.org/chromium/src/out/Debug/gen/third_party/blink/public/mojom/indexeddb/indexeddb.mojom.h?type=cs&sq=package:chromium&g=0&l=60
        // We set the chunk size to 64MB to stay well-below the limit
        var CHUNK_SIZE = 64 * 1024 * 1024;

        function cacheRemotePackage(
          db,
          packageName,
          packageData,
          packageMeta,
          callback,
          errback
        ) {
          var transactionPackages = db.transaction([PACKAGE_STORE_NAME], IDB_RW);
          var packages = transactionPackages.objectStore(PACKAGE_STORE_NAME);
          var chunkSliceStart = 0;
          var nextChunkSliceStart = 0;
          var chunkCount = Math.ceil(packageData.byteLength / CHUNK_SIZE);
          var finishedChunks = 0;
          for (var chunkId = 0; chunkId < chunkCount; chunkId++) {
            nextChunkSliceStart += CHUNK_SIZE;
            var putPackageRequest = packages.put(
              packageData.slice(chunkSliceStart, nextChunkSliceStart),
              'package/' + packageName + '/' + chunkId
            );
            chunkSliceStart = nextChunkSliceStart;
            putPackageRequest.onsuccess = function(event) {
              finishedChunks++;
              if (finishedChunks == chunkCount) {
                var transaction_metadata = db.transaction(
                  [METADATA_STORE_NAME],
                  IDB_RW
                );
                var metadata = transaction_metadata.objectStore(METADATA_STORE_NAME);
                var putMetadataRequest = metadata.put(
                  {
                    'uuid': packageMeta.uuid,
                    'chunkCount': chunkCount
                  },
                  'metadata/' + packageName
                );
                putMetadataRequest.onsuccess = function(event) {
                  callback(packageData);
                };
                putMetadataRequest.onerror = function(error) {
                  errback(error);
                };
              }
            };
            putPackageRequest.onerror = function(error) {
              errback(error);
            };
          }
        }

        /* Check if there's a cached package, and if so whether it's the latest available */
        function checkCachedPackage(db, packageName, callback, errback) {
          var transaction = db.transaction([METADATA_STORE_NAME], IDB_RO);
          var metadata = transaction.objectStore(METADATA_STORE_NAME);
          var getRequest = metadata.get('metadata/' + packageName);
          getRequest.onsuccess = function(event) {
            var result = event.target.result;
            if (!result) {
              return callback(false, null);
            } else {
              return callback(PACKAGE_UUID === result['uuid'], result);
            }
          };
          getRequest.onerror = function(error) {
            errback(error);
          };
        }

        function fetchCachedPackage(db, packageName, metadata, callback, errback) {
          var transaction = db.transaction([PACKAGE_STORE_NAME], IDB_RO);
          var packages = transaction.objectStore(PACKAGE_STORE_NAME);

          var chunksDone = 0;
          var totalSize = 0;
          var chunkCount = metadata['chunkCount'];
          var chunks = new Array(chunkCount);

          for (var chunkId = 0; chunkId < chunkCount; chunkId++) {
            var getRequest = packages.get('package/' + packageName + '/' + chunkId);
            getRequest.onsuccess = function(event) {
              // If there's only 1 chunk, there's nothing to concatenate it with so we can just return it now
              if (chunkCount == 1) {
                callback(event.target.result);
              } else {
                chunksDone++;
                totalSize += event.target.result.byteLength;
                chunks.push(event.target.result);
                if (chunksDone == chunkCount) {
                  if (chunksDone == 1) {
                    callback(event.target.result);
                  } else {
                    var tempTyped = new Uint8Array(totalSize);
                    var byteOffset = 0;
                    for (var chunkId in chunks) {
                      var buffer = chunks[chunkId];
                      tempTyped.set(new Uint8Array(buffer), byteOffset);
                      byteOffset += buffer.byteLength;
                      buffer = undefined;
                    }
                    chunks = undefined;
                    callback(tempTyped.buffer);
                    tempTyped = undefined;
                  }
                }
              }
            };
            getRequest.onerror = function(error) {
              errback(error);
            };
          }
        }
      
      function processPackageData(arrayBuffer) {
        assert(arrayBuffer, 'Loading data file failed.');
        assert(arrayBuffer instanceof ArrayBuffer, 'bad input to processPackageData');
        var byteArray = new Uint8Array(arrayBuffer);
        var curr;
        
          // Reuse the bytearray from the XHR as the source for file reads.
          DataRequest.prototype.byteArray = byteArray;
    
            var files = metadata['files'];
            for (var i = 0; i < files.length; ++i) {
              DataRequest.prototype.requests[files[i].filename].onload();
            }
                Module['removeRunDependency']('datafile_pyapp.data');

      };
      Module['addRunDependency']('datafile_pyapp.data');
    
      if (!Module.preloadResults) Module.preloadResults = {};
    
        function preloadFallback(error) {
          console.error(error);
          console.error('falling back to default preload behavior');
          fetchRemotePackage(REMOTE_PACKAGE_NAME, REMOTE_PACKAGE_SIZE, processPackageData, handleError);
        };

        openDatabase(
          function(db) {
            checkCachedPackage(db, PACKAGE_PATH + PACKAGE_NAME,
              function(useCached, metadata) {
                Module.preloadResults[PACKAGE_NAME] = {fromCache: useCached};
                if (useCached) {
                  fetchCachedPackage(db, PACKAGE_PATH + PACKAGE_NAME, metadata, processPackageData, preloadFallback);
                } else {
                  fetchRemotePackage(REMOTE_PACKAGE_NAME, REMOTE_PACKAGE_SIZE,
                    function(packageData) {
                      cacheRemotePackage(db, PACKAGE_PATH + PACKAGE_NAME, packageData, {uuid:PACKAGE_UUID}, processPackageData,
                        function(error) {
                          console.error(error);
                          processPackageData(packageData);
                        });
                    }
                  , preloadFallback);
                }
              }
            , preloadFallback);
          }
        , preloadFallback);

        if (Module['setStatus']) Module['setStatus']('Downloading...');
      
    }
    if (Module['calledRun']) {
      runWithFS();
    } else {
      if (!Module['preRun']) Module['preRun'] = [];
      Module["preRun"].push(runWithFS); // FS is not initialized yet, wait for it
    }
  
   }
   loadPackage({"files": [{"filename": "/web-presplash-default.jpg", "start": 0, "end": 224232, "audio": 0}, {"filename": "/six.pyo", "start": 224232, "end": 251851, "audio": 0}, {"filename": "/typing.pyo", "start": 251851, "end": 321357, "audio": 0}, {"filename": "/_dummy_thread/__init__.pyo", "start": 321357, "end": 321884, "audio": 0}, {"filename": "/http/cookies.pyo", "start": 321884, "end": 322149, "audio": 0}, {"filename": "/http/client.pyo", "start": 322149, "end": 324437, "audio": 0}, {"filename": "/http/__init__.pyo", "start": 324437, "end": 324878, "audio": 0}, {"filename": "/http/cookiejar.pyo", "start": 324878, "end": 325109, "audio": 0}, {"filename": "/http/server.pyo", "start": 325109, "end": 325587, "audio": 0}, {"filename": "/xmlrpc/client.pyo", "start": 325587, "end": 325817, "audio": 0}, {"filename": "/xmlrpc/__init__.pyo", "start": 325817, "end": 326260, "audio": 0}, {"filename": "/xmlrpc/server.pyo", "start": 326260, "end": 326490, "audio": 0}, {"filename": "/_thread/__init__.pyo", "start": 326490, "end": 327005, "audio": 0}, {"filename": "/libpasteurize/__init__.pyo", "start": 327005, "end": 327119, "audio": 0}, {"filename": "/libpasteurize/main.pyo", "start": 327119, "end": 332314, "audio": 0}, {"filename": "/libpasteurize/fixes/fix_future_builtins.pyo", "start": 332314, "end": 333802, "audio": 0}, {"filename": "/libpasteurize/fixes/__init__.pyo", "start": 333802, "end": 334732, "audio": 0}, {"filename": "/libpasteurize/fixes/fix_imports2.pyo", "start": 334732, "end": 344473, "audio": 0}, {"filename": "/libpasteurize/fixes/fix_features.pyo", "start": 344473, "end": 347512, "audio": 0}, {"filename": "/libpasteurize/fixes/fix_raise_.pyo", "start": 347512, "end": 349012, "audio": 0}, {"filename": "/libpasteurize/fixes/fix_getcwd.pyo", "start": 349012, "end": 350098, "audio": 0}, {"filename": "/libpasteurize/fixes/fix_newstyle.pyo", "start": 350098, "end": 351423, "audio": 0}, {"filename": "/libpasteurize/fixes/fix_unpacking.pyo", "start": 351423, "end": 356603, "audio": 0}, {"filename": "/libpasteurize/fixes/feature_base.pyo", "start": 356603, "end": 358284, "audio": 0}, {"filename": "/libpasteurize/fixes/fix_division.pyo", "start": 358284, "end": 359407, "audio": 0}, {"filename": "/libpasteurize/fixes/fix_memoryview.pyo", "start": 359407, "end": 360283, "audio": 0}, {"filename": "/libpasteurize/fixes/fix_throw.pyo", "start": 360283, "end": 361558, "audio": 0}, {"filename": "/libpasteurize/fixes/fix_add_all_future_builtins.pyo", "start": 361558, "end": 362438, "audio": 0}, {"filename": "/libpasteurize/fixes/fix_add_future_standard_library_import.pyo", "start": 362438, "end": 363310, "audio": 0}, {"filename": "/libpasteurize/fixes/fix_next.pyo", "start": 363310, "end": 364948, "audio": 0}, {"filename": "/libpasteurize/fixes/fix_imports.pyo", "start": 364948, "end": 368918, "audio": 0}, {"filename": "/libpasteurize/fixes/fix_annotations.pyo", "start": 368918, "end": 370708, "audio": 0}, {"filename": "/libpasteurize/fixes/fix_raise.pyo", "start": 370708, "end": 372189, "audio": 0}, {"filename": "/libpasteurize/fixes/fix_printfunction.pyo", "start": 372189, "end": 372966, "audio": 0}, {"filename": "/libpasteurize/fixes/fix_kwargs.pyo", "start": 372966, "end": 376670, "audio": 0}, {"filename": "/libpasteurize/fixes/fix_fullargspec.pyo", "start": 376670, "end": 377536, "audio": 0}, {"filename": "/libpasteurize/fixes/fix_add_all__future__imports.pyo", "start": 377536, "end": 378447, "audio": 0}, {"filename": "/libpasteurize/fixes/fix_metaclass.pyo", "start": 378447, "end": 380804, "audio": 0}, {"filename": "/six-1.12.0.dist-info/top_level.txt", "start": 380804, "end": 380808, "audio": 0}, {"filename": "/six-1.12.0.dist-info/METADATA", "start": 380808, "end": 382748, "audio": 0}, {"filename": "/six-1.12.0.dist-info/RECORD", "start": 382748, "end": 383285, "audio": 0}, {"filename": "/six-1.12.0.dist-info/INSTALLER", "start": 383285, "end": 383289, "audio": 0}, {"filename": "/six-1.12.0.dist-info/LICENSE", "start": 383289, "end": 384355, "audio": 0}, {"filename": "/six-1.12.0.dist-info/WHEEL", "start": 384355, "end": 384465, "audio": 0}, {"filename": "/socketserver/__init__.pyo", "start": 384465, "end": 384952, "audio": 0}, {"filename": "/past/__init__.pyo", "start": 384952, "end": 385242, "audio": 0}, {"filename": "/past/builtins/noniterators.pyo", "start": 385242, "end": 387365, "audio": 0}, {"filename": "/past/builtins/__init__.pyo", "start": 387365, "end": 388461, "audio": 0}, {"filename": "/past/builtins/misc.pyo", "start": 388461, "end": 390798, "audio": 0}, {"filename": "/past/types/__init__.pyo", "start": 390798, "end": 391323, "audio": 0}, {"filename": "/past/types/oldstr.pyo", "start": 391323, "end": 393889, "audio": 0}, {"filename": "/past/types/basestring.pyo", "start": 393889, "end": 394931, "audio": 0}, {"filename": "/past/types/olddict.pyo", "start": 394931, "end": 396693, "audio": 0}, {"filename": "/past/utils/__init__.pyo", "start": 396693, "end": 398172, "audio": 0}, {"filename": "/past/translation/__init__.pyo", "start": 398172, "end": 408046, "audio": 0}, {"filename": "/builtins/__init__.pyo", "start": 408046, "end": 408599, "audio": 0}, {"filename": "/libfuturize/__init__.pyo", "start": 408599, "end": 408711, "audio": 0}, {"filename": "/libfuturize/fixer_util.pyo", "start": 408711, "end": 419360, "audio": 0}, {"filename": "/libfuturize/main.pyo", "start": 419360, "end": 427452, "audio": 0}, {"filename": "/libfuturize/fixes/fix_future_builtins.pyo", "start": 427452, "end": 429034, "audio": 0}, {"filename": "/libfuturize/fixes/fix_object.pyo", "start": 429034, "end": 429772, "audio": 0}, {"filename": "/libfuturize/fixes/fix_print_with_import.pyo", "start": 429772, "end": 430548, "audio": 0}, {"filename": "/libfuturize/fixes/__init__.pyo", "start": 430548, "end": 432914, "audio": 0}, {"filename": "/libfuturize/fixes/fix_absolute_import.pyo", "start": 432914, "end": 434978, "audio": 0}, {"filename": "/libfuturize/fixes/fix_cmp.pyo", "start": 434978, "end": 435985, "audio": 0}, {"filename": "/libfuturize/fixes/fix_add__future__imports_except_unicode_literals.pyo", "start": 435985, "end": 436932, "audio": 0}, {"filename": "/libfuturize/fixes/fix_basestring.pyo", "start": 436932, "end": 437682, "audio": 0}, {"filename": "/libfuturize/fixes/fix_division.pyo", "start": 437682, "end": 437888, "audio": 0}, {"filename": "/libfuturize/fixes/fix_input.pyo", "start": 437888, "end": 438600, "audio": 0}, {"filename": "/libfuturize/fixes/fix_division_safe.pyo", "start": 438600, "end": 441448, "audio": 0}, {"filename": "/libfuturize/fixes/fix_execfile.pyo", "start": 441448, "end": 442480, "audio": 0}, {"filename": "/libfuturize/fixes/fix_unicode_literals_import.pyo", "start": 442480, "end": 443287, "audio": 0}, {"filename": "/libfuturize/fixes/fix_order___future__imports.pyo", "start": 443287, "end": 444052, "audio": 0}, {"filename": "/libfuturize/fixes/fix_bytes.pyo", "start": 444052, "end": 445006, "audio": 0}, {"filename": "/libfuturize/fixes/fix_raise.pyo", "start": 445006, "end": 447044, "audio": 0}, {"filename": "/libfuturize/fixes/fix_print.pyo", "start": 447044, "end": 449325, "audio": 0}, {"filename": "/libfuturize/fixes/fix_future_standard_library_urllib.pyo", "start": 449325, "end": 450222, "audio": 0}, {"filename": "/libfuturize/fixes/fix_UserDict.pyo", "start": 450222, "end": 452681, "audio": 0}, {"filename": "/libfuturize/fixes/fix_xrange_with_import.pyo", "start": 452681, "end": 453442, "audio": 0}, {"filename": "/libfuturize/fixes/fix_remove_old__future__imports.pyo", "start": 453442, "end": 454330, "audio": 0}, {"filename": "/libfuturize/fixes/fix_unicode_keep_u.pyo", "start": 454330, "end": 455214, "audio": 0}, {"filename": "/libfuturize/fixes/fix_oldstr_wrap.pyo", "start": 455214, "end": 456512, "audio": 0}, {"filename": "/libfuturize/fixes/fix_next_call.pyo", "start": 456512, "end": 459576, "audio": 0}, {"filename": "/libfuturize/fixes/fix_metaclass.pyo", "start": 459576, "end": 465138, "audio": 0}, {"filename": "/libfuturize/fixes/fix_future_standard_library.pyo", "start": 465138, "end": 465957, "audio": 0}, {"filename": "/bin/pasteurize", "start": 465957, "end": 466262, "audio": 0}, {"filename": "/bin/futurize", "start": 466262, "end": 466565, "audio": 0}, {"filename": "/ecdsa-0.18.0.dist-info/top_level.txt", "start": 466565, "end": 466571, "audio": 0}, {"filename": "/ecdsa-0.18.0.dist-info/METADATA", "start": 466571, "end": 496321, "audio": 0}, {"filename": "/ecdsa-0.18.0.dist-info/RECORD", "start": 496321, "end": 499678, "audio": 0}, {"filename": "/ecdsa-0.18.0.dist-info/INSTALLER", "start": 499678, "end": 499682, "audio": 0}, {"filename": "/ecdsa-0.18.0.dist-info/LICENSE", "start": 499682, "end": 500829, "audio": 0}, {"filename": "/ecdsa-0.18.0.dist-info/WHEEL", "start": 500829, "end": 500939, "audio": 0}, {"filename": "/html/__init__.pyo", "start": 500939, "end": 501423, "audio": 0}, {"filename": "/html/entities.pyo", "start": 501423, "end": 501742, "audio": 0}, {"filename": "/html/parser.pyo", "start": 501742, "end": 502158, "audio": 0}, {"filename": "/ecdsa/test_ellipticcurve.pyo", "start": 502158, "end": 509878, "audio": 0}, {"filename": "/ecdsa/eddsa.pyo", "start": 509878, "end": 517095, "audio": 0}, {"filename": "/ecdsa/test_ecdsa.pyo", "start": 517095, "end": 537079, "audio": 0}, {"filename": "/ecdsa/__init__.pyo", "start": 537079, "end": 538622, "audio": 0}, {"filename": "/ecdsa/test_malformed_sigs.pyo", "start": 538622, "end": 548348, "audio": 0}, {"filename": "/ecdsa/rfc6979.pyo", "start": 548348, "end": 550251, "audio": 0}, {"filename": "/ecdsa/curves.pyo", "start": 550251, "end": 560386, "audio": 0}, {"filename": "/ecdsa/keys.pyo", "start": 560386, "end": 579098, "audio": 0}, {"filename": "/ecdsa/numbertheory.pyo", "start": 579098, "end": 592291, "audio": 0}, {"filename": "/ecdsa/test_numbertheory.pyo", "start": 592291, "end": 607794, "audio": 0}, {"filename": "/ecdsa/ecdh.pyo", "start": 607794, "end": 612552, "audio": 0}, {"filename": "/ecdsa/test_keys.pyo", "start": 612552, "end": 645682, "audio": 0}, {"filename": "/ecdsa/_rwlock.pyo", "start": 645682, "end": 647936, "audio": 0}, {"filename": "/ecdsa/der.pyo", "start": 647936, "end": 657675, "audio": 0}, {"filename": "/ecdsa/test_der.pyo", "start": 657675, "end": 678343, "audio": 0}, {"filename": "/ecdsa/_compat.pyo", "start": 678343, "end": 683384, "audio": 0}, {"filename": "/ecdsa/errors.pyo", "start": 683384, "end": 683679, "audio": 0}, {"filename": "/ecdsa/util.pyo", "start": 683679, "end": 692755, "audio": 0}, {"filename": "/ecdsa/test_pyecdsa.pyo", "start": 692755, "end": 764522, "audio": 0}, {"filename": "/ecdsa/test_eddsa.pyo", "start": 764522, "end": 795615, "audio": 0}, {"filename": "/ecdsa/ellipticcurve.pyo", "start": 795615, "end": 829016, "audio": 0}, {"filename": "/ecdsa/test_curves.pyo", "start": 829016, "end": 843015, "audio": 0}, {"filename": "/ecdsa/test_rw_lock.pyo", "start": 843015, "end": 848552, "audio": 0}, {"filename": "/ecdsa/test_jacobi.pyo", "start": 848552, "end": 867720, "audio": 0}, {"filename": "/ecdsa/_version.pyo", "start": 867720, "end": 868191, "audio": 0}, {"filename": "/ecdsa/ecdsa.pyo", "start": 868191, "end": 884495, "audio": 0}, {"filename": "/ecdsa/test_ecdh.pyo", "start": 884495, "end": 898489, "audio": 0}, {"filename": "/ecdsa/_sha3.pyo", "start": 898489, "end": 902269, "audio": 0}, {"filename": "/ecdsa/test_sha3.pyo", "start": 902269, "end": 905507, "audio": 0}, {"filename": "/lib/python2.7/threading.pyo", "start": 905507, "end": 909945, "audio": 0}, {"filename": "/lib/python2.7/subprocess.pyo", "start": 909945, "end": 910061, "audio": 0}, {"filename": "/lib/python2.7/site-packages/pygame_sdl2/__init__.pyo", "start": 910061, "end": 914967, "audio": 0}, {"filename": "/lib/python2.7/site-packages/pygame_sdl2/compat.pyo", "start": 914967, "end": 918345, "audio": 0}, {"filename": "/lib/python2.7/site-packages/pygame_sdl2/time.pyo", "start": 918345, "end": 918534, "audio": 0}, {"filename": "/lib/python2.7/site-packages/pygame_sdl2/version.pyo", "start": 918534, "end": 919030, "audio": 0}, {"filename": "/lib/python2.7/site-packages/pygame_sdl2/sysfont.pyo", "start": 919030, "end": 939136, "audio": 0}, {"filename": "/lib/python2.7/site-packages/pygame_sdl2/sprite.pyo", "start": 939136, "end": 967357, "audio": 0}, {"filename": "/lib/python2.7/site-packages/pygame_sdl2/threads/__init__.pyo", "start": 967357, "end": 973674, "audio": 0}, {"filename": "/lib/python2.7/site-packages/pygame_sdl2/threads/Py25Queue.pyo", "start": 973674, "end": 979225, "audio": 0}, {"filename": "/_markupbase/__init__.pyo", "start": 979225, "end": 979748, "audio": 0}, {"filename": "/future-0.18.2.dist-info/top_level.txt", "start": 979748, "end": 979896, "audio": 0}, {"filename": "/future-0.18.2.dist-info/entry_points.txt", "start": 979896, "end": 979985, "audio": 0}, {"filename": "/future-0.18.2.dist-info/DESCRIPTION.rst", "start": 979985, "end": 982648, "audio": 0}, {"filename": "/future-0.18.2.dist-info/METADATA", "start": 982648, "end": 986350, "audio": 0}, {"filename": "/future-0.18.2.dist-info/metadata.json", "start": 986350, "end": 987770, "audio": 0}, {"filename": "/future-0.18.2.dist-info/RECORD", "start": 987770, "end": 1017916, "audio": 0}, {"filename": "/future-0.18.2.dist-info/LICENSE.txt", "start": 1017916, "end": 1018999, "audio": 0}, {"filename": "/future-0.18.2.dist-info/INSTALLER", "start": 1018999, "end": 1019003, "audio": 0}, {"filename": "/future-0.18.2.dist-info/WHEEL", "start": 1019003, "end": 1019096, "audio": 0}, {"filename": "/future/__init__.pyo", "start": 1019096, "end": 1019559, "audio": 0}, {"filename": "/future/builtins/__init__.pyo", "start": 1019559, "end": 1020802, "audio": 0}, {"filename": "/future/builtins/newsuper.pyo", "start": 1020802, "end": 1022605, "audio": 0}, {"filename": "/future/builtins/newnext.pyo", "start": 1022605, "end": 1023293, "audio": 0}, {"filename": "/future/builtins/newround.pyo", "start": 1023293, "end": 1025198, "audio": 0}, {"filename": "/future/builtins/iterators.pyo", "start": 1025198, "end": 1025823, "audio": 0}, {"filename": "/future/builtins/new_min_max.pyo", "start": 1025823, "end": 1027465, "audio": 0}, {"filename": "/future/builtins/misc.pyo", "start": 1027465, "end": 1029227, "audio": 0}, {"filename": "/future/builtins/disabled.pyo", "start": 1029227, "end": 1030252, "audio": 0}, {"filename": "/future/backports/_markupbase.pyo", "start": 1030252, "end": 1038864, "audio": 0}, {"filename": "/future/backports/__init__.pyo", "start": 1038864, "end": 1039509, "audio": 0}, {"filename": "/future/backports/socketserver.pyo", "start": 1039509, "end": 1053147, "audio": 0}, {"filename": "/future/backports/socket.pyo", "start": 1053147, "end": 1063766, "audio": 0}, {"filename": "/future/backports/misc.pyo", "start": 1063766, "end": 1085604, "audio": 0}, {"filename": "/future/backports/datetime.pyo", "start": 1085604, "end": 1136084, "audio": 0}, {"filename": "/future/backports/total_ordering.pyo", "start": 1136084, "end": 1138710, "audio": 0}, {"filename": "/future/backports/http/cookies.pyo", "start": 1138710, "end": 1153935, "audio": 0}, {"filename": "/future/backports/http/client.pyo", "start": 1153935, "end": 1183441, "audio": 0}, {"filename": "/future/backports/http/__init__.pyo", "start": 1183441, "end": 1183563, "audio": 0}, {"filename": "/future/backports/http/cookiejar.pyo", "start": 1183563, "end": 1231769, "audio": 0}, {"filename": "/future/backports/http/server.pyo", "start": 1231769, "end": 1261960, "audio": 0}, {"filename": "/future/backports/xmlrpc/client.pyo", "start": 1261960, "end": 1296642, "audio": 0}, {"filename": "/future/backports/xmlrpc/__init__.pyo", "start": 1296642, "end": 1296766, "audio": 0}, {"filename": "/future/backports/xmlrpc/server.pyo", "start": 1296766, "end": 1318616, "audio": 0}, {"filename": "/future/backports/html/__init__.pyo", "start": 1318616, "end": 1319266, "audio": 0}, {"filename": "/future/backports/html/entities.pyo", "start": 1319266, "end": 1384550, "audio": 0}, {"filename": "/future/backports/html/parser.pyo", "start": 1384550, "end": 1398317, "audio": 0}, {"filename": "/future/backports/email/base64mime.pyo", "start": 1398317, "end": 1400514, "audio": 0}, {"filename": "/future/backports/email/_encoded_words.pyo", "start": 1400514, "end": 1406068, "audio": 0}, {"filename": "/future/backports/email/feedparser.pyo", "start": 1406068, "end": 1417267, "audio": 0}, {"filename": "/future/backports/email/__init__.pyo", "start": 1417267, "end": 1419050, "audio": 0}, {"filename": "/future/backports/email/utils.pyo", "start": 1419050, "end": 1428637, "audio": 0}, {"filename": "/future/backports/email/_header_value_parser.pyo", "start": 1428637, "end": 1509727, "audio": 0}, {"filename": "/future/backports/email/encoders.pyo", "start": 1509727, "end": 1512137, "audio": 0}, {"filename": "/future/backports/email/headerregistry.pyo", "start": 1512137, "end": 1531318, "audio": 0}, {"filename": "/future/backports/email/errors.pyo", "start": 1531318, "end": 1536810, "audio": 0}, {"filename": "/future/backports/email/iterators.pyo", "start": 1536810, "end": 1538809, "audio": 0}, {"filename": "/future/backports/email/parser.pyo", "start": 1538809, "end": 1542505, "audio": 0}, {"filename": "/future/backports/email/_policybase.pyo", "start": 1542505, "end": 1550039, "audio": 0}, {"filename": "/future/backports/email/_parseaddr.pyo", "start": 1550039, "end": 1562271, "audio": 0}, {"filename": "/future/backports/email/message.pyo", "start": 1562271, "end": 1579613, "audio": 0}, {"filename": "/future/backports/email/policy.pyo", "start": 1579613, "end": 1583670, "audio": 0}, {"filename": "/future/backports/email/charset.pyo", "start": 1583670, "end": 1590673, "audio": 0}, {"filename": "/future/backports/email/quoprimime.pyo", "start": 1590673, "end": 1597801, "audio": 0}, {"filename": "/future/backports/email/generator.pyo", "start": 1597801, "end": 1609183, "audio": 0}, {"filename": "/future/backports/email/header.pyo", "start": 1609183, "end": 1623004, "audio": 0}, {"filename": "/future/backports/email/mime/base.pyo", "start": 1623004, "end": 1623890, "audio": 0}, {"filename": "/future/backports/email/mime/__init__.pyo", "start": 1623890, "end": 1624018, "audio": 0}, {"filename": "/future/backports/email/mime/image.pyo", "start": 1624018, "end": 1625172, "audio": 0}, {"filename": "/future/backports/email/mime/text.pyo", "start": 1625172, "end": 1626285, "audio": 0}, {"filename": "/future/backports/email/mime/audio.pyo", "start": 1626285, "end": 1627926, "audio": 0}, {"filename": "/future/backports/email/mime/application.pyo", "start": 1627926, "end": 1629044, "audio": 0}, {"filename": "/future/backports/email/mime/multipart.pyo", "start": 1629044, "end": 1630043, "audio": 0}, {"filename": "/future/backports/email/mime/nonmultipart.pyo", "start": 1630043, "end": 1630985, "audio": 0}, {"filename": "/future/backports/email/mime/message.pyo", "start": 1630985, "end": 1632091, "audio": 0}, {"filename": "/future/backports/test/keycert.passwd.pem", "start": 1632091, "end": 1633921, "audio": 0}, {"filename": "/future/backports/test/nullbytecert.pem", "start": 1633921, "end": 1639356, "audio": 0}, {"filename": "/future/backports/test/__init__.pyo", "start": 1639356, "end": 1639480, "audio": 0}, {"filename": "/future/backports/test/ssl_key.pem", "start": 1639480, "end": 1640396, "audio": 0}, {"filename": "/future/backports/test/nokia.pem", "start": 1640396, "end": 1642319, "audio": 0}, {"filename": "/future/backports/test/keycert2.pem", "start": 1642319, "end": 1644114, "audio": 0}, {"filename": "/future/backports/test/badcert.pem", "start": 1644114, "end": 1646042, "audio": 0}, {"filename": "/future/backports/test/ssl_cert.pem", "start": 1646042, "end": 1646909, "audio": 0}, {"filename": "/future/backports/test/badkey.pem", "start": 1646909, "end": 1649071, "audio": 0}, {"filename": "/future/backports/test/dh512.pem", "start": 1649071, "end": 1649473, "audio": 0}, {"filename": "/future/backports/test/support.pyo", "start": 1649473, "end": 1698710, "audio": 0}, {"filename": "/future/backports/test/ssl_servers.pyo", "start": 1698710, "end": 1706824, "audio": 0}, {"filename": "/future/backports/test/sha256.pem", "start": 1706824, "end": 1715168, "audio": 0}, {"filename": "/future/backports/test/ssl_key.passwd.pem", "start": 1715168, "end": 1716131, "audio": 0}, {"filename": "/future/backports/test/nullcert.pem", "start": 1716131, "end": 1716131, "audio": 0}, {"filename": "/future/backports/test/pystone.pyo", "start": 1716131, "end": 1722868, "audio": 0}, {"filename": "/future/backports/test/keycert.pem", "start": 1722868, "end": 1724651, "audio": 0}, {"filename": "/future/backports/test/https_svn_python_org_root.pem", "start": 1724651, "end": 1727220, "audio": 0}, {"filename": "/future/backports/urllib/__init__.pyo", "start": 1727220, "end": 1727344, "audio": 0}, {"filename": "/future/backports/urllib/response.pyo", "start": 1727344, "end": 1731389, "audio": 0}, {"filename": "/future/backports/urllib/robotparser.pyo", "start": 1731389, "end": 1737519, "audio": 0}, {"filename": "/future/backports/urllib/parse.pyo", "start": 1737519, "end": 1762884, "audio": 0}, {"filename": "/future/backports/urllib/request.pyo", "start": 1762884, "end": 1834817, "audio": 0}, {"filename": "/future/backports/urllib/error.pyo", "start": 1834817, "end": 1837270, "audio": 0}, {"filename": "/future/standard_library/__init__.pyo", "start": 1837270, "end": 1851090, "audio": 0}, {"filename": "/future/tests/base.pyo", "start": 1851090, "end": 1863999, "audio": 0}, {"filename": "/future/tests/__init__.pyo", "start": 1863999, "end": 1864112, "audio": 0}, {"filename": "/future/moves/itertools.pyo", "start": 1864112, "end": 1864455, "audio": 0}, {"filename": "/future/moves/_markupbase.pyo", "start": 1864455, "end": 1864806, "audio": 0}, {"filename": "/future/moves/__init__.pyo", "start": 1864806, "end": 1865186, "audio": 0}, {"filename": "/future/moves/copyreg.pyo", "start": 1865186, "end": 1865601, "audio": 0}, {"filename": "/future/moves/socketserver.pyo", "start": 1865601, "end": 1865956, "audio": 0}, {"filename": "/future/moves/configparser.pyo", "start": 1865956, "end": 1866272, "audio": 0}, {"filename": "/future/moves/subprocess.pyo", "start": 1866272, "end": 1866782, "audio": 0}, {"filename": "/future/moves/reprlib.pyo", "start": 1866782, "end": 1867119, "audio": 0}, {"filename": "/future/moves/collections.pyo", "start": 1867119, "end": 1867843, "audio": 0}, {"filename": "/future/moves/builtins.pyo", "start": 1867843, "end": 1868221, "audio": 0}, {"filename": "/future/moves/winreg.pyo", "start": 1868221, "end": 1868559, "audio": 0}, {"filename": "/future/moves/_thread.pyo", "start": 1868559, "end": 1868898, "audio": 0}, {"filename": "/future/moves/queue.pyo", "start": 1868898, "end": 1869232, "audio": 0}, {"filename": "/future/moves/sys.pyo", "start": 1869232, "end": 1869556, "audio": 0}, {"filename": "/future/moves/pickle.pyo", "start": 1869556, "end": 1869950, "audio": 0}, {"filename": "/future/moves/_dummy_thread.pyo", "start": 1869950, "end": 1870307, "audio": 0}, {"filename": "/future/moves/dbm/__init__.pyo", "start": 1870307, "end": 1870819, "audio": 0}, {"filename": "/future/moves/dbm/ndbm.pyo", "start": 1870819, "end": 1871157, "audio": 0}, {"filename": "/future/moves/dbm/gnu.pyo", "start": 1871157, "end": 1871494, "audio": 0}, {"filename": "/future/moves/dbm/dumb.pyo", "start": 1871494, "end": 1871836, "audio": 0}, {"filename": "/future/moves/http/cookies.pyo", "start": 1871836, "end": 1872224, "audio": 0}, {"filename": "/future/moves/http/client.pyo", "start": 1872224, "end": 1872553, "audio": 0}, {"filename": "/future/moves/http/__init__.pyo", "start": 1872553, "end": 1872777, "audio": 0}, {"filename": "/future/moves/http/cookiejar.pyo", "start": 1872777, "end": 1873133, "audio": 0}, {"filename": "/future/moves/http/server.pyo", "start": 1873133, "end": 1873733, "audio": 0}, {"filename": "/future/moves/xmlrpc/client.pyo", "start": 1873733, "end": 1874048, "audio": 0}, {"filename": "/future/moves/xmlrpc/__init__.pyo", "start": 1874048, "end": 1874168, "audio": 0}, {"filename": "/future/moves/xmlrpc/server.pyo", "start": 1874168, "end": 1874483, "audio": 0}, {"filename": "/future/moves/html/__init__.pyo", "start": 1874483, "end": 1875178, "audio": 0}, {"filename": "/future/moves/html/entities.pyo", "start": 1875178, "end": 1875537, "audio": 0}, {"filename": "/future/moves/html/parser.pyo", "start": 1875537, "end": 1875888, "audio": 0}, {"filename": "/future/moves/test/__init__.pyo", "start": 1875888, "end": 1876175, "audio": 0}, {"filename": "/future/moves/test/support.pyo", "start": 1876175, "end": 1876627, "audio": 0}, {"filename": "/future/moves/urllib/__init__.pyo", "start": 1876627, "end": 1876916, "audio": 0}, {"filename": "/future/moves/urllib/response.pyo", "start": 1876916, "end": 1877412, "audio": 0}, {"filename": "/future/moves/urllib/robotparser.pyo", "start": 1877412, "end": 1877778, "audio": 0}, {"filename": "/future/moves/urllib/parse.pyo", "start": 1877778, "end": 1878641, "audio": 0}, {"filename": "/future/moves/urllib/request.pyo", "start": 1878641, "end": 1879874, "audio": 0}, {"filename": "/future/moves/urllib/error.pyo", "start": 1879874, "end": 1880434, "audio": 0}, {"filename": "/future/moves/tkinter/commondialog.pyo", "start": 1880434, "end": 1880912, "audio": 0}, {"filename": "/future/moves/tkinter/colorchooser.pyo", "start": 1880912, "end": 1881390, "audio": 0}, {"filename": "/future/moves/tkinter/messagebox.pyo", "start": 1881390, "end": 1881860, "audio": 0}, {"filename": "/future/moves/tkinter/__init__.pyo", "start": 1881860, "end": 1882638, "audio": 0}, {"filename": "/future/moves/tkinter/scrolledtext.pyo", "start": 1882638, "end": 1883112, "audio": 0}, {"filename": "/future/moves/tkinter/constants.pyo", "start": 1883112, "end": 1883578, "audio": 0}, {"filename": "/future/moves/tkinter/dialog.pyo", "start": 1883578, "end": 1884028, "audio": 0}, {"filename": "/future/moves/tkinter/ttk.pyo", "start": 1884028, "end": 1884466, "audio": 0}, {"filename": "/future/moves/tkinter/filedialog.pyo", "start": 1884466, "end": 1884932, "audio": 0}, {"filename": "/future/moves/tkinter/tix.pyo", "start": 1884932, "end": 1885370, "audio": 0}, {"filename": "/future/moves/tkinter/font.pyo", "start": 1885370, "end": 1885816, "audio": 0}, {"filename": "/future/moves/tkinter/simpledialog.pyo", "start": 1885816, "end": 1886290, "audio": 0}, {"filename": "/future/moves/tkinter/dnd.pyo", "start": 1886290, "end": 1886732, "audio": 0}, {"filename": "/future/types/__init__.pyo", "start": 1886732, "end": 1889329, "audio": 0}, {"filename": "/future/types/newobject.pyo", "start": 1889329, "end": 1890851, "audio": 0}, {"filename": "/future/types/newrange.pyo", "start": 1890851, "end": 1896103, "audio": 0}, {"filename": "/future/types/newopen.pyo", "start": 1896103, "end": 1897485, "audio": 0}, {"filename": "/future/types/newmemoryview.pyo", "start": 1897485, "end": 1898353, "audio": 0}, {"filename": "/future/types/newlist.pyo", "start": 1898353, "end": 1900873, "audio": 0}, {"filename": "/future/types/newdict.pyo", "start": 1900873, "end": 1903215, "audio": 0}, {"filename": "/future/types/newint.pyo", "start": 1903215, "end": 1914530, "audio": 0}, {"filename": "/future/types/newbytes.pyo", "start": 1914530, "end": 1927327, "audio": 0}, {"filename": "/future/types/newstr.pyo", "start": 1927327, "end": 1938999, "audio": 0}, {"filename": "/future/utils/surrogateescape.pyo", "start": 1938999, "end": 1942864, "audio": 0}, {"filename": "/future/utils/__init__.pyo", "start": 1942864, "end": 1958171, "audio": 0}, {"filename": "/copyreg/__init__.pyo", "start": 1958171, "end": 1958649, "audio": 0}, {"filename": "/winreg/__init__.pyo", "start": 1958649, "end": 1959164, "audio": 0}, {"filename": "/typing-3.10.0.0.dist-info/top_level.txt", "start": 1959164, "end": 1959171, "audio": 0}, {"filename": "/typing-3.10.0.0.dist-info/METADATA", "start": 1959171, "end": 1961436, "audio": 0}, {"filename": "/typing-3.10.0.0.dist-info/RECORD", "start": 1961436, "end": 1962009, "audio": 0}, {"filename": "/typing-3.10.0.0.dist-info/INSTALLER", "start": 1962009, "end": 1962013, "audio": 0}, {"filename": "/typing-3.10.0.0.dist-info/LICENSE", "start": 1962013, "end": 1974768, "audio": 0}, {"filename": "/typing-3.10.0.0.dist-info/WHEEL", "start": 1974768, "end": 1974860, "audio": 0}, {"filename": "/queue/__init__.pyo", "start": 1974860, "end": 1975372, "audio": 0}, {"filename": "/tkinter/commondialog.pyo", "start": 1975372, "end": 1975837, "audio": 0}, {"filename": "/tkinter/colorchooser.pyo", "start": 1975837, "end": 1976302, "audio": 0}, {"filename": "/tkinter/messagebox.pyo", "start": 1976302, "end": 1976759, "audio": 0}, {"filename": "/tkinter/__init__.pyo", "start": 1976759, "end": 1977649, "audio": 0}, {"filename": "/tkinter/scrolledtext.pyo", "start": 1977649, "end": 1978110, "audio": 0}, {"filename": "/tkinter/constants.pyo", "start": 1978110, "end": 1978563, "audio": 0}, {"filename": "/tkinter/dialog.pyo", "start": 1978563, "end": 1979000, "audio": 0}, {"filename": "/tkinter/ttk.pyo", "start": 1979000, "end": 1979425, "audio": 0}, {"filename": "/tkinter/filedialog.pyo", "start": 1979425, "end": 1980033, "audio": 0}, {"filename": "/tkinter/tix.pyo", "start": 1980033, "end": 1980458, "audio": 0}, {"filename": "/tkinter/font.pyo", "start": 1980458, "end": 1980891, "audio": 0}, {"filename": "/tkinter/simpledialog.pyo", "start": 1980891, "end": 1981352, "audio": 0}, {"filename": "/tkinter/dnd.pyo", "start": 1981352, "end": 1981781, "audio": 0}, {"filename": "/reprlib/__init__.pyo", "start": 1981781, "end": 1982255, "audio": 0}], "remote_package_size": 1982255, "package_uuid": "41e1c019-f4ce-454b-ac64-1157880155a1"});
  
  })();
  