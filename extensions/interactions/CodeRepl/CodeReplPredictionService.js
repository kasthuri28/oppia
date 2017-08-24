// Copyright 2017 The Oppia Authors. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS-IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * CodeRepl interaction prediction functions.
 *
 * IMPORTANT NOTE: The prediction function uses the classifier data
 * of trained model (code classifier model) for inference. These functions
 * must be changed if there are any changes in corresponding classifier training
 * function on Oppia-ml.
 */

oppia.factory('CodeReplPredictionService', [
  'WinnowingPreprocessingService', 'SVMPredictionService',
  'PythonProgramTokenizer', 'PythonProgramTokenType',
  'CountVectorizerService', function(
    WinnowingPreprocessingService, SVMPredictionService,
    PythonProgramTokenizer, PythonProgramTokenType, CountVectorizerService) {
    // The string with which all the variable and method names need to be
    // replaced.
    var TOKEN_NAME_VAR = 'V';
    // The string with which all unknown tokens (tokens which are ignored
    // because they appear rarely in a program) will be replaced.
    var TOKEN_NAME_UNK = 'UNK';

    // List of python keywords.
    var KW_LIST = [
      'and', 'as', 'assert', 'break', 'class', 'continue', 'def', 'del',
      'elif', 'else', 'except', 'exec', 'finally', 'for', 'from', 'global',
      'if', 'import', 'in', 'is', 'lambda', 'not', 'or', 'pass', 'print',
      'raise', 'return', 'try', 'while', 'with', 'yield'];

    return {
      getTokenizedProgram: function(programTokens, tokenToId) {
        // Tokenize Python programs in dataset for winnowing.
        tokenizedProgram = [];

        for (var i = 0; i < programTokens.length; i++) {
          var token = programTokens[i];
          var tokenId = token[0];
          var tokenName = token[1];

          if (
            tokenId === PythonProgramTokenType.NL ||
            tokenId === PythonProgramTokenType.COMMENT ||
            tokenName.trim() === '') {
            continue;
          }
          else if (
            tokenId === PythonProgramTokenType.NAME &&
            KW_LIST.indexOf(tokenName) === -1) {
            tokenizedProgram.push(TOKEN_NAME_VAR);
          }
          else {
            if (tokenToId.hasOwnProperty(tokenName)) {
              tokenizedProgram.push(tokenName);
            }
            else {
              tokenizedProgram.push(TOKEN_NAME_UNK)
            }
          }
        }

        return tokenizedProgram;
      },

      getTokenizedProgramForCV: function(programTokens) {
        // Tokenize Python programs in dataset for winnowing.
        tokenizedProgram = [];

        for (var i = 0; i < programTokens.length; i++) {
          var token = programTokens[i];
          var tokenId = token[0];
          var tokenName = token[1];

          if (
            tokenId === PythonProgramTokenType.NL ||
            tokenId === PythonProgramTokenType.COMMENT ||
            tokenName.trim() === '') {
            continue;
          }
          else if (
            tokenId === PythonProgramTokenType.NAME &&
            KW_LIST.indexOf(tokenName) === -1) {
            tokenizedProgram.push(TOKEN_NAME_VAR);
          }
          else {
            tokenizedProgram.push(tokenName);
          }
        }

        return tokenizedProgram;
      },

      calcJaccardIndex: function(multisetA, multisetB) {
        // Calculate jaccard index between two multisets.
        multisetA.sort();
        multisetB.sort();

        var smallSet = (
          (multisetA.length <= multisetB.length) ?
          multisetA.slice() : multisetB.slice());
        var unionSet = (
          (multisetA.length > multisetB.length) ?
          multisetA.slice() : multisetB.slice());
        var index = 0;
        var extraElements = [];

        smallSet.forEach(function(elem) {
          while (index < unionSet.length && elem > unionSet[index]) {
            index += 1;
          }
          if (index >= unionSet.length || elem < unionSet[index]) {
            extraElements.push(elem);
          }
          else if (elem === unionSet[index]) {
            index += 1;
          }
        });

        unionSet = unionSet.concat(extraElements);

        index = 0;
        var intersectionSet = [];
        multisetA.forEach(function(elem) {
          while (index < multisetB.length && elem > multisetB[index]) {
            index += 1;
          }
          if (index < multisetB.length && elem === multisetB[index]) {
            intersectionSet.push(elem);
            index += 1;
          }
        });

        var coeff = intersectionSet.length / unionSet.length;
        return coeff;
      },

      getProgramSimilarity: function(fingerprintA, fingerprintB) {
        // Calculate similarity between two programs' fingerprints.
        var multisetA = [];
        var multisetB = [];

        fingerprintA.forEach(function(hash) {
          multisetA.push(hash[0]);
        });

        fingerprintB.forEach(function(hash) {
          multisetB.push(hash[0]);
        });

        return this.calcJaccardIndex(multisetA, multisetB);
      },

      findNearestNeighborsIndexes: function(knnData, program) {
        // Find index of nearest neighbor programs to given program.
        var K = knnData.K;
        var T = knnData.T;
        var fingerprintData = knnData.fingerprint_data;
        var tokenToId = knnData.token_to_id;
        var top = knnData.top;

        // Find program tokens using python program tokenizer.
        var pythonProgramTokens = PythonProgramTokenizer.generateTokens(
          program.split('\n'));

        // Normalize program tokens for winnowing preprocessing. This removes
        // unnecessary tokens and normalizes variable and method name tokens.

        var tokenizedProgram = this.getTokenizedProgram(
          pythonProgramTokens, tokenToId);
        // Find k-gram hashes from normalized program tokens.

        var programHashes = WinnowingPreprocessingService.getKGramHashes(
          tokenizedProgram, tokenToId, K);
        // Find fingerprint from k-gram hashes of program.

        var programFingerprint = (
          WinnowingPreprocessingService.getFingerprintFromHashes(
            programHashes, T, K));

        // Calculte similarity of the input program with every program in
        // classifier data for k nearest neighbor classification.
        similarityList = [];
        Object.keys(fingerprintData).forEach(function(index) {
          var fingerprintA = fingerprintData.index.fingerprint;
          var similarity = this.getProgramSimilarity(
            fingerprintA, programFingerprint);
          similarityList.push([index, similarity]);
        });

        // Sort the programs according to their similairy with the
        // input program.
        similarityList.sort(function(x, y) {
          return x[1] < y[1];
        });

        var nearestNeighborsIndexes = similarityList.slice(0, top);
        return nearestNeighborsIndexes;
      },

      predict: function(classifierData, program) {
        var knnData = classifierData.KNN;
        var svmData = classifierData.SVM;
        var cvVocabulary = classifierData.cv_vocabulary;

        var fingerprintData = knnData.fingerprintData;
        var top = knnData.top;
        var occurrence = knnData.occurrence;

        var nearestNeighborsIndexes = this.findNearestNeighborsIndexes(
          knnData, program);
        var nearesNeighborsClasses = [];
        
        // Find classes of nearest neighbor programs.
        nearestNeighborsIndexes.forEach(function(neighbor) {
          var index = neighbor[0];
          var outputClassPropertyName = 'class';
          var similarity = neighbor[1];
          nearesNeighborsClasses.push(
            [fingerprintData.index[outputClassPropertyName]], similarity);
        });

        // Count how many times a class appears in nearest neighbors.
        var classCount = {};
        nearesNeighborsClasses.forEach(function(neighbor) {
          var outputClass = neighbor[0];
          if (classCount.hasOwnProperty(outputClass)) {
            classCount[outputClass] += 1;
          }
          else {
            classCount[outputClass] = 1;
          }
        });

        // Find the winning class.
        var classCountArray = []
        Object.keys(classCount).forEach(function(k) {
          classCountArray.push([k, classCount[k]]);
        })

        var predictedClass = classCountArray[0][0];
        var predictedClassOccurrence = classCountArray[0][1];
        if (predictedClassOccurrence >= occurrence &&
            predictedClassOccurrence != classCountArray[1][1]) {
          return predictedClass;
        }

        // If KNN fails to predict then use SVM to predict the output class.

        // Find program tokens using python program tokenizer.
        var pythonProgramTokens = PythonProgramTokenizer.generateTokens(
          program.split('\n'));

        var tokenizedProgram = this.getTokenizedProgramForCV(
          pythonProgramTokens);
        var programVector = CountVectorizerService.vectorize(
          tokenizedProgram, cvVocabulary);

        prediction = SVMPredictionService.predict(svmData, programVector);
        return prediction;
      }
    };
  }]);