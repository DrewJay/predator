/**
 * Pred(ictor)ator class is construct simplifying
 * all kinds of regressions and neural network model
 * creation. Based on tensorflow js.
 */
const Predator = function(config) {
    // << Launch configuration cheat sheet >>
    // -> neural/model:
    //      + epochs {number} @ 10
    //      + loss {string} @ 'meanSquaredError'
    //      + optimizer {string} @ 'adam'
    //      + ttSplit {number} @ 2
    // -> neural/layers:
    //      + bias {boolean} @ true
    //      + activation {string} @ 'sigmoid'
    //      + amount {number} @ 3
    //      + nodes {number} @ 10
    //      + tensorShapes {array}{array} @ [[max(1), len(param[0])], [max(1), len(param[1])]]
    //      + override {array}
    // -> system:
    //      + visual {boolean} @ false
    //      + params {array}{array|string}
    //      + csvPath {string}
    this.config = Predator.applyDefaults(config);

    // << Generated configuration cheat sheet >>
    // -> /
    //      + latestModel {model}
    //      + layers {array}
    //      + performance {string}
    // -> loss
    //      + test {number}
    //      + train {number}
    // -> adjusted
    //      + with {string}
    //      + using {number}
    this.config.generated = {};

    this.tensorCache = [];
    this.points = [];

    /**
     * Combine multiple generic plots. This method allows functionality
     * that should never be used. Use case table of truth:
     *
     * +-------------------+---------------------------------------+
     * | Param combination |                Use case               |
     * |                   |                                       |
     * |     F F model     | + Only latestModel csv                |
     * |     F F string    | + Only latestModel csv                |
     * |     F F null      | + Only latestModel csv                |
     * |     F T model     | + Only model prediction line          |
     * |     F T string    | + Only model prediction line          |
     * |     F T null      | + latestModel csv + latestModel pred  | ✔ standard
     * |     T F model     | + Only model csv                      |
     * |     T F string    | + Only model csv                      |
     * |     T F null      | + Only latestModel csv                |
     * |     T T model     | + latestModel csv + model pred        |
     * |     T T string    | + model csv + pred                    | ✔ standard
     * |     T T null      | + latestModel csv + latestModel pred  |
     * +-------------------+---------------------------------------+
     * @param shouldAggregate - If should simulate synthetic state.
     * @param shouldPredict - If should render prediction line.
     * @param modelData - Object containing model name or model itself.
     */
    this.mergePlot = async (shouldAggregate, shouldPredict, modelData) => {
        // Use instance configuration for rendering.
        if (!modelData && this.config.generated.latestModel) { 
            
            // If model name is 'Anonymous', lookup would fail. So we will use model itself.
            modelData = (this.config.generated.latestModel.modelName === Predator.constants.modelFallbackName) ?
                { model: this.config.generated.latestModel } : 
                this.config.generated.latestModel.modelName;
            
                shouldAggregate = false;

        // No instance configuration available means problems.
        } else if (!modelData) {
            return Predator.error(
                'InstanceNotTrainedYet',
                'Predator instance has to train a model first before it can render anonymous merge plot.'
            );
        }
        
        if (!this.config.system.visual) { return false; }
        if (!tfvis.visor().isOpen()) { tfvis.visor().toggle(); }

        const model = await Predator.unpackModel(modelData);
        
        // Can not predict without model.
        if (!model && shouldPredict) {
            return Predator.error(
                'NoPredictionModel',
                'No model could be retrieved for prediction.'
            );            
        }
        
        if (shouldAggregate) {
            if (model && model.modelName) {
                await this.applyPredatorInstanceSnapshot(model.modelName, true);
            // Can not aggregate without model.
            } else {
                return Predator.error(
                    'NoAggregationModel',
                    'No model could be retrieved for aggregation, or model was found but has no name.'
                );
            }
        }

        const predictedPoints = (shouldPredict) ? await this.generatePredictionPoints({ model }) : [];
        const pointArrays = [this.points];
        const seriesArrays = ['original'];

        if (predictedPoints) {
            pointArrays.push(predictedPoints);
            seriesArrays.push('predicted');
        }

        await Predator.genericPlot([this.points, predictedPoints], ['original', 'predicted'], modelData, this);
    }

    /**
     * Generate prediction points that form a line.
     * 
     * @param modelData - Object containing model name or model itself.
     * @returns Array of points.
     */
    this.generatePredictionPoints = async (modelData) => {
        const model = await Predator.unpackModel(modelData) || this.config.generated.latestModel;
        const targetDimension = this.config.neural.layers.tensorShapes[0].slice(1);
        const dimensionProduct = targetDimension.reduce((a, b) => a * b);
        const scaler = 100;
        const pointAmount = dimensionProduct * scaler;

        if (!model) { return []; }

        const [xs, ys] = tf.tidy(() => {
            const normalizedXs = tf.linspace(0, 1, pointAmount),
                  normalizedYs = model.predict(normalizedXs.reshape([scaler, targetDimension].flat()));

            const dnxs = Predator.denormalizeTensor(normalizedXs, this.tensorCache[0]),
                  dnys = Predator.denormalizeTensor(normalizedYs, this.tensorCache[1]);

            return [ dnxs.dataSync(), dnys.dataSync() ];
        });

        return Array.from(xs).map((val, index) => {
            return { x: val, y: ys[index] };
        });
    }

    /**
     * Attempt to make a prediction.
     * Should be used in try/catch block.
     * 
     * @param values - Feature values.
     * @param modelData - Object containing model name or model itself. Can either be:
     *                    1.) Left out empty to use latest model trained by instance.
     *                    2.) Contain named or unnamed model object.
     *                    3.) Contain model name.
     * @returns Predicted x value.
     */
    this.predict = async (values, modelData) => {
        // By default, aggregation is on.
        let shouldAggregate = true;

        // Validate the input.
        if (!Predator.inputValidator(values)) {
            throw Predator.error(
                'IncorrectInputType',
                'One of input values has incorrect type.'
            );
        }
        
        // Attempt to fall back for the latestModel in use during this session.
        if (this.config.generated.latestModel && (!modelData || this.config.generated.latestModel.modelName === modelData.name)) {
            modelData = this.config.generated.latestModel.modelName;
            shouldAggregate = false;
        }

        // Load the model.
        let model = await Predator.unpackModel(modelData);

        // Model was not found.
        if (model === false) {
            throw Predator.error(
                'NoModelAvailable',
                'No model was found for this prediction.'
            ); 
        }
    
        // Only if prediction is not bound to current instance.
        if (shouldAggregate) {
            await this.applyPredatorInstanceSnapshot(model.modelName, true);
        }

        const paramLen = Array.isArray(this.config.system.params[0]) ? this.config.system.params[0].length : 1;
        
        if (paramLen !== values.length) {
            throw Predator.error(
                'BadInput',
                `Model "${model.modelName}" expects ${paramLen} inputs but got ${values.length}.`
            );
        }

        // Except the first dimension (acting as a null), the rest of dimensions have to match the training tensor.
        const inputTensor = Predator.normalizeTensor(Predator.makeTensor(values, [1, this.config.neural.layers.tensorShapes[0].slice(1)].flat()), this.tensorCache[0]);
        const outputTensor = Predator.denormalizeTensor(model.predict(inputTensor), this.tensorCache[1]);
        return outputTensor.dataSync();
    }

    /**
     * Aggregate particular Predator instance configuration based on
     * tensorflow model that was previously trained by the instance.
     * 
     * @param modelName - If used, state is aggregated from saved model.
     * @param turboCache - When building snapshot from configuration, the
     * process is very slow, because CSV file needs to be parsed again. This
     * happens due to the fact that we need to recreate tensorCache and for
     * this the min() and max() functions requiring actual dataset are used.
     * turboCache allows to fetch dataset from localStorage instead of direct
     * CSV parsing, which is super fast.
     */
    this.applyPredatorInstanceSnapshot = async (modelName, turboCache) => {
        // Aggregation is not needed at times.
        if (this.config.generated.latestModel && this.config.generated.latestModel.modelName === modelName) { return true; }

        this.config = Predator.getConfig(modelName, this.config);

        // Set the latestModel variable.
        this.config.generated.latestModel = await Predator.unpackModel(modelName);

        // Solution for legacy models, which had no two-dimensional tensorshapes.
        if (!Array.isArray(this.config.neural.layers.tensorShapes[0])) { 
            this.config.neural.layers.tensorShapes = [this.config.neural.layers.tensorShapes, this.config.neural.layers.tensorShapes]; 
        }

        const params = this.config.system.params;
        if (turboCache !== true) {
            this.points = await Predator.consumeCSV(this.config.system.csvPath, params);
        } else {
            this.points = JSON.parse(localStorage.getItem(`${Predator.constants.bigDataPath}/${modelName}`));
        }

        this.tensorCache = [];

        // We don't need to use this, it just sets instance tensor cache.
        await Predator.tensorFromArray(this.config.neural.layers.tensorShapes[0], this.points, 'x', this);
        await Predator.tensorFromArray(this.config.neural.layers.tensorShapes[1], this.points, 'y', this);
    }

    /**
     * Run training session.
     * 
     * @param name - Model name to save.
     */
    this.session = async (name) => {
        // Capture initial time.
        const startTime = performance.now();

        // Acknowledge the session start.
        Predator.log('Trainig in progress...');

        // Reset tensorCache.
        this.tensorCache = [];

        // Read data from CSV.
        this.points = await Predator.consumeCSV(this.config.system.csvPath, this.config.system.params);
        
        // Create feature and label tensors.
        const featureTensor = await Predator.tensorFromArray(this.config.neural.layers.tensorShapes[0], this.points, 'x', this),
              labelTensor = await Predator.tensorFromArray(this.config.neural.layers.tensorShapes[1], this.points, 'y', this);

        // Normalization is complicated. Give user some information.
        this.config.generated.normalized = {
            was: true,
            with: Predator.constants.normalizationDefault,
            sample: {
                original: this.points.slice(0, 3).map(item => item.x).flat(),
                normal: (await featureTensor.array()).slice(0, 3).flat(),
            },
        };

        // Test-train split.
        const [trainFeatureTensor, testFeatureTensor] = tf.split(featureTensor, this.config.neural.model.ttSplit),
              [trainLabelTensor, testLabelTensor] = tf.split(labelTensor, this.config.neural.model.ttSplit);
        
        // Create tsfjs model and train it.
        const layers = this.config.neural.layers.override ||
            Predator.symmetricDNNGenerator(
                { amount: this.config.neural.layers.amount, units: this.config.neural.layers.nodes, bias: this.config.neural.layers.bias, activation: this.config.neural.layers.activation },
                this.config.neural.layers.tensorShapes
            );

        this.config.generated.layers = layers;

        const model = Predator.createModel(
            layers, this.config.neural.model.optimizer, this.config.neural.model.loss
        );

        const trainResult = await Predator.train(model, this.config.neural.model.epochs, { trainFeatureTensor, trainLabelTensor }, this.config.system.visual);
        this.config.generated.latestModel = model;
        this.config.generated.latestModel.modelName = name || Predator.constants.modelFallbackName;

        // If name is set, save the model.
        if (name) {
            await Predator.saveModel(model, name, this.points, this.config);
        }

        // Calculate test and train loss.
        const lossTensor = model.evaluate(testFeatureTensor, testLabelTensor);
        const testLoss = (await lossTensor.dataSync())[0];
        const trainLoss = trainResult.history.loss[this.config.neural.model.epochs - 1];

        this.config.generated.loss = { train: trainLoss, test: testLoss };
        
        // Plot the results.
        await this.mergePlot(false, true);

        if (this.config.system.visual) {
            tfvis.render.barchart({ name: 'Test vs Train' }, [{ index: 'Test', value: testLoss }, { index: 'Train', value: trainLoss }]);
        }

        // Calculate session time.
        this.config.generated.performance = `${(Math.round(( (performance.now() - startTime) / 1000) * 100) / 100)}s`;

        // Acknowledge session end.
        Predator.log('Training finished.');

        return model;
    }
}

/**
 * Apply default values to missing configurations.
 * 
 * @param config - Current configuration object.
 * @returns New configuration object.
 */
Predator.applyDefaults = (config) => {
    let neural = config.neural;
    const params = config.system.params;
    const keys = ['model/epochs', 'model/loss', 'model/optimizer', 'model/ttSplit', 'layers/bias', 'layers/activation', 'layers/amount', 'layers/nodes', 'layers/tensorShapes'];
    const defaults = [10, 'meanSquaredError', 'adam', 2, true, 'sigmoid', 3, 10, [[Predator.max(1), Predator.paramLength(params[0])], [Predator.max(1), Predator.paramLength(params[1])]]];

    if (!neural) { config.neural = {}; neural = {}; }
    if (!neural.model) { config.neural.model = {}; neural.model = {}; }
    if (!neural.layers) { config.neural.layers = {}; neural.layers = {}; }

    if (Object.entries(neural.layers).length === 0 && Object.entries(neural.model).length === 0) { 
        Predator.log('Using default preset for standard regression task. Feel free to specify your configuration @ instance.config.'); 
    }

    keys.forEach((value, idx) => {
        [space, key] = value.split('/');
        if (!config.neural[space][key]) {
            config.neural[space][key] = defaults[idx];
        }
    });

    return config;
}

/**
 * Create new predator error.
 * 
 * @param name - Error name.
 * @param text - Error text.
 * @returns New error.
 */
Predator.error = (name, text) => {
    let err = new Error(text);
    err.name = `pred::${name}`;
    return err;
}

/**
 * Get length of params, wheter it's array or a string.
 * 
 * @param param - Subject param.
 * @returns Length.
 */
Predator.paramLength = (param) => {
    if (Array.isArray(param)) {
        return param.length;
    } else {
        return 1;
    }
}

/**
 * Return length of an input.
 * 
 * @param divide - Divisor.
 * @returns Object containing operation information.
 */
Predator.max = (divide = 1) => {
    return {
        fn: (input) => input.length / divide,
        name: 'max',
        param: divide,
    }
}

/**
 * Normalize tensor values (downscaling).
 * 
 * @param tensor - Tensor object.
 * @param override - Use min and max from this overriding tensor.
 * @returns Normalized tensor.
 */
Predator.normalizeTensor = (tensor, override) => {
    const min = (override) ? override.min() : tensor.min();
    const max = (override) ? override.max() : tensor.max();
    return tensor.sub(min).div(max.sub(min));
}

/**
 * Denormalize tensor values (upscaling).
 * 
 * @param tensor - Tensor object.
 * @param override - Use min and max from this overriding tensor.
 * @returns Denormalized tensor.
 */
Predator.denormalizeTensor = (tensor, override) => {
    const min = (override) ? override.min() : tensor.min();
    const max = (override) ? override.max() : tensor.max();
    return tensor.mul(max.sub(min)).add(min);
}

/**
 * Create tsfjs model used for training and testing.
 * 
 * @param layers - Array of objects defining layers.
 * @param optimizerName - String name of optimizer function.
 * @param loss - Name of a loss function.
 * @returns Compiled tsfjs model.
 */
Predator.createModel = (layers, optimizerName, loss) => {
    const model = tf.sequential();

    for (const layer of layers) {
        model.add(tf.layers.dense(layer));
    }

    const optimizer = tf.train[optimizerName]();

    model.compile({
        loss,
        optimizer
    });

    return model;
}

/**
 * Engage model training phase.
 * 
 * @param model - Tsfjs model reference.
 * @param epochs - Amount of epochs.
 * @param tensors - Feature and label tensors.
 * @param showProgess - Visually show training progress.
 * @returns Training data.
 */
Predator.train = async (model, epochs, { trainFeatureTensor, trainLabelTensor }, showProgress = false) => {
    let callbacks = {};

    if (showProgress) {
        const { onBatchEnd, onEpochEnd } = tfvis.show.fitCallbacks(
            { name: "Training Performance" },
            ['loss']
        );
        callbacks = { onEpochEnd };
    }
    
    return await model.fit(trainFeatureTensor, trainLabelTensor, {
        epochs,
        callbacks,
    });
}

/**
 * Read CSV from gived URL.
 * 
 * @param url - Path to CSV.
 * @param params - If present, override local params.
 * @returns Array-ized CSV data.
 */
Predator.consumeCSV = async (url, params) => {
    const data = tf.data.csv(url);
    
    const pointDataSet = await data.map(record => ({
        x: Predator.spreadRecordFields(record, params[0]),
        y: Predator.spreadRecordFields(record, params[1]),
    }));

    const _points = await pointDataSet.toArray();
    tf.util.shuffle(_points);
    _points.pop();

    return _points;
}

/**
 * Spread CSV record fields to form single array
 * with keys and values.
 * 
 * @param record - CSV row.
 * @param params - Searched parameters.
 * @returns Array of values.
 */
Predator.spreadRecordFields = (record, params) => {
    let values = [];

    if (!Array.isArray(params)) { return record[params]; }

    params.forEach((val) => {
        values.push(record[val]);
    });

    return values;
}

/**
 * Create tsfjs Tensor object from array.
 * 
 * @param shape - Shape of the tensor.
 * @param arr - Input array of objects.
 * @param field - Field name we seek in object.
 * @param instance - Predator instance (optional).
 * @returns Tsfjs Tensor object.
 */
Predator.tensorFromArray = async (shape, arr, field, instance) => {
    instance.shapeIndex = (field === 'x') ? 0 : 1;
    
    shape = Predator.adjustTensorShapes(shape, arr, instance);

    if (instance) { instance.config.neural.layers.tensorShapes[instance.shapeIndex] = shape; }

    const fetchedArray = await arr.map(val => val[field]);

    const adjustedArray = fetchedArray.slice(0, shape.reduce((a,b) => a * b ));
    const tensor = Predator.makeTensor(adjustedArray, shape);
    if (instance) { instance.tensorCache.push(tensor); }
    return Predator.normalizeTensor(tensor);
}

/**
 * Adjust tensor dimensions.
 * 
 * @param shape - Tensor shape.
 * @param points - Reference points array.
 * @param saveTo - Instance where to save modifying parameters.
 * @returns Adjusted tensor shape.
 */
Predator.adjustTensorShapes = (shape, points, saveTo) => {
    saveTo.config.generated.adjusted = saveTo.config.generated.adjusted || [];
    shape.forEach((value, index) => {
        if (typeof value === 'object') {
            if (saveTo) { saveTo.config.generated.adjusted[saveTo.shapeIndex] = { with: value.name, using: value.param }; delete saveTo.shapeindex; }
            shape[index] = value.fn(points);
        }
    });

    return shape;
}

/**
 * Save tsfjs model into local storage.
 * 
 * @param model - Tsfjs model reference .
 * @param modelName - Model name.
 * @param data - Additional data to save.
 * @param config - Predator configuration.
 * @returns Saving result.
 */
Predator.saveModel = async (model, modelName, data, config) => {
    // 1.) latestModel is large object with large amount of unserializable content
    // 2.) Saving loss has no point at all
    let reducedConfig = JSON.parse(JSON.stringify(config));
    delete reducedConfig.generated.latestModel;
    delete reducedConfig.generated.loss;

    localStorage.setItem(`${Predator.constants.configPath}/${modelName}`, JSON.stringify(reducedConfig));
    localStorage.setItem(`predator/bigdata/${modelName}`, JSON.stringify(data));
    return await model.save(`localstorage://${modelName}`);
}

/**
 * Attempt to retrieve model training configuration.
 * 
 * @param modelName - Name of a model.
 * @param fallback - Fallback config.
 * @returns Configuration object.
 */
Predator.getConfig = (modelName, fallback) => {
    const data = localStorage.getItem(`${Predator.constants.configPath}/${modelName}`);
    
    if (data) { 
        Predator.log(`Config for model '${modelName}' found.`);
    } else {
        Predator.log(`Config for model '${modelName}' not found.`);
        
        // If config was not found and no fallback is present, Predator can not continue.
        if (!fallback) {
            throw Predator.error(
                'ConfigLookupFailure',
                `Config for model '${modelName}' does not exist and no fallback was provided.`
            );
        } else {
            Predator.log('Predator will use config fallback, since it is present.');
        }
    }
    
    return (data) ? JSON.parse(data) : fallback;
}

/**
 * Get model from localstorage by name.
 * 
 * @param modelName - Name of the model.
 * @returns Tsfjs model reference.
 */
Predator.getModelByName = async (modelName) => {
    const modelInfo = (await tf.io.listModels())[`localstorage://${modelName}`];
    if (modelInfo) {
        let model = await tf.loadLayersModel(`localstorage://${modelName}`);
        model.modelName = modelName;
        return model;
    }
    return false;
}

/**
 * Retrieve model from model data object. This function is main consumer
 * of modelData used widely in app.
 * 
 * @param modelData - Object containing model information or stringified model name.
 * @param noModelCallback - Function to execute if model was not found.
 * @returns Tensorflow model.
 */
Predator.unpackModel = async (modelData) => {
    if (!modelData) {
        return false;
    } else if (!modelData.model) {
        const model = await Predator.getModelByName(modelData.name || modelData); // Pure modelData is solution for bare string model name.
        if (!model) { if (modelData.noModelCallback) { modelData.noModelCallback(); } return false; }
        else { return model; }
    } else {
        return modelData.model;
    }
}

/**
 * Plot data to scatter plot.
 * 
 * @param values - Array of values to plot.
 * @param series - Array of series to apply.
 * @param modelData - Object containing model info.
 * @param instance - Predator instance (optional).
 */
Predator.genericPlot = (values, series, modelData, instance) => {
    const modelName = (typeof modelData === 'string') ? modelData : (modelData.name || Predator.constants.modelFallbackName);
    let featureName, labelName;

    if (instance) {
        const config = Predator.getConfig(modelName, instance.config);
        featureName = config.system.params[0];
        labelName = config.system.params[1];
    } else {
        featureName = Predator.constants.ioFallbackName;
        labelName = Predator.constants.ioFallbackName;
    }

    const name = `${featureName} and ${labelName} correlation (${modelName})`

    tfvis.render.scatterplot(
        { name },
        { values, series },
        { xLabel: featureName, yLabel: labelName }
    );
}

/**
 * Log stylized message to console.
 * 
 * @param message - Message to display.
 * @param enabler - Injective boolean condition which can stop logs.
 */
Predator.log = (message, enabler) => {
    if (enabler !== false) {
        console.log(`%c Predator %c log %c >>>%c ${message}`,
            'background-color: #ff9933; color:black; padding: 3px; font-size: 13px; border-radius: 5px; border-top-right-radius: 0; border-bottom-right-radius: 0;',
            'background-color: #e67300; font-size: 13px; color: black; padding: 3px; border-top-right-radius: 5px; border-bottom-right-radius: 5px;',
            'background-color: none; color: #e67300;',
            'background-color: none; color: black;'
        );
    }
}

/**
 * Predator version indicator. Stable version equals recommended.
 */
Predator.version = "v1.0.1 'Wild Ox' stable";

/**
 * Constants to be used anywhere in Predator constructor
 * or particular instances.
 */
Predator.constants = {
    modelFallbackName: 'Anonymous',
    ioFallbackName: 'Unknown',
    bigDataPath: 'predator/bigdata',
    configPath: 'predator/config',
    normalizationDefault: 'Predator.normalizeTensor',
}

/**
 * Check if all array members are valid Predator inputs.
 * 
 * @param input - Array input.
 * @returns Flag if input is valid type.
 */
Predator.inputValidator = (input) => {
    return input.every(val => !isNaN(val));
}

/**
 * Fetch and return array of saved model names from local storage.
 */
Predator.savedModels = async () => {
    const models = await tf.io.listModels();
    return Object.keys(models).map((name) => name.replace('localstorage://', ''));
}

/**
 * Get tensor creating function based on
 * defined tensor shape.
 * 
 * If tensor shape was defined as for example 3d (e.g [9, 3, 2]), it means that
 * corresponding param shape has to be three dimensional as well.
 * 
 * If input data tensor is defined as for example 3d (e.g [9, 3, 2]), results tensor has to be
 * 3d as well, with matching leftover dimensions ([, 3, 2]).
 * 
 * @param points - Input points.
 * @param shape - Tensor shape.
 * @returns Tensor creating function.
 */
Predator.makeTensor = (points, shape) => {
    const builder = tf[`tensor${shape.length}d`];
    return builder(points.flat(), shape);
}

/**
 * Generate dense layers based on tensor shape. Layers are symmetric and
 * share common functionality.
 * 
 * @param params - Parameters defining dense layers.
 * @param tensorShapes - Shape of input tensor data.
 * @returns Array of dense layers.
 */
Predator.symmetricDNNGenerator = ({ amount, units, bias, activation }, tensorShapes) => {
    try {
        let layers = [];
        
        let shape = tensorShapes[0].slice(1, -1);
        shape.push(units);

        for (let i = 0; i < amount; i++) {
            if (i === 0) {
                layers.push(
                    { units, useBias: bias, inputShape: tensorShapes[0].slice(1) }
                );
            } else if (i === amount - 1) {
                layers.push(
                    { units: tensorShapes[1].slice(-1)[0], useBias: bias, activation: activation, inputShape: shape }
                );
            } else {
                layers.push(
                    { units, useBias: bias, inputShape: shape }
                );
            }
        }

        return layers;
    } catch (exception) {
        throw Predator.error(
            'DNNGeneratorException',
            `Symmetric DNN could not be generated. Please check your inputs.\n\nError message: ${exception.message}.`
        );
    }
}
