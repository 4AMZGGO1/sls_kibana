"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getStringFieldsStats = exports.getNumericFieldsStats = exports.getDocumentCountStats = exports.getDateFieldsStats = exports.getBooleanFieldsStats = void 0;
var _lodash = require("lodash");
var _query_utils = require("../../../common/utils/query_utils");
var _object_utils = require("../../../common/utils/object_utils");
var _process_distribution_data = require("./process_distribution_data");
var _constants = require("./constants");
/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

const getDocumentCountStats = async (client, indexPatternTitle, query, timeFieldName, earliestMs, latestMs, intervalMs, runtimeMappings) => {
  const {
    asCurrentUser
  } = client;
  const index = indexPatternTitle;
  const size = 0;
  const filterCriteria = (0, _query_utils.buildBaseFilterCriteria)(timeFieldName, earliestMs, latestMs, query);

  // Don't use the sampler aggregation as this can lead to some potentially
  // confusing date histogram results depending on the date range of data amongst shards.

  const aggs = {
    eventRate: {
      date_histogram: {
        field: timeFieldName,
        fixed_interval: `${intervalMs}ms`,
        min_doc_count: 1
      }
    }
  };
  const searchBody = {
    query: {
      bool: {
        filter: filterCriteria
      }
    },
    aggs,
    ...((0, _object_utils.isPopulatedObject)(runtimeMappings) ? {
      runtime_mappings: runtimeMappings
    } : {})
  };
  const {
    body
  } = await asCurrentUser.search({
    index,
    size,
    body: searchBody
  });
  const buckets = {};
  const dataByTimeBucket = (0, _lodash.get)(body, ['aggregations', 'eventRate', 'buckets'], []);
  (0, _lodash.each)(dataByTimeBucket, dataForTime => {
    const time = dataForTime.key;
    buckets[time] = dataForTime.doc_count;
  });
  return {
    documentCounts: {
      interval: intervalMs,
      buckets
    }
  };
};
exports.getDocumentCountStats = getDocumentCountStats;
const getNumericFieldsStats = async (client, indexPatternTitle, query, fields, samplerShardSize, timeFieldName, earliestMs, latestMs, runtimeMappings) => {
  const {
    asCurrentUser
  } = client;
  const index = indexPatternTitle;
  const size = 0;
  const filterCriteria = (0, _query_utils.buildBaseFilterCriteria)(timeFieldName, earliestMs, latestMs, query);

  // Build the percents parameter which defines the percentiles to query
  // for the metric distribution data.
  // Use a fixed percentile spacing of 5%.
  const MAX_PERCENT = 100;
  const PERCENTILE_SPACING = 5;
  let count = 0;
  const percents = Array.from(Array(MAX_PERCENT / PERCENTILE_SPACING), () => count += PERCENTILE_SPACING);
  const aggs = {};
  fields.forEach((field, i) => {
    const safeFieldName = (0, _query_utils.getSafeAggregationName)(field.fieldName, i);
    aggs[`${safeFieldName}_field_stats`] = {
      filter: {
        exists: {
          field: field.fieldName
        }
      },
      aggs: {
        actual_stats: {
          stats: {
            field: field.fieldName
          }
        }
      }
    };
    aggs[`${safeFieldName}_percentiles`] = {
      percentiles: {
        field: field.fieldName,
        percents,
        keyed: false
      }
    };
    const top = {
      terms: {
        field: field.fieldName,
        size: 10,
        order: {
          _count: 'desc'
        }
      }
    };

    // If cardinality >= SAMPLE_TOP_TERMS_THRESHOLD, run the top terms aggregation
    // in a sampler aggregation, even if no sampling has been specified (samplerShardSize < 1).
    if (samplerShardSize < 1 && field.cardinality >= _constants.SAMPLER_TOP_TERMS_THRESHOLD) {
      aggs[`${safeFieldName}_top`] = {
        sampler: {
          shard_size: _constants.SAMPLER_TOP_TERMS_SHARD_SIZE
        },
        aggs: {
          top
        }
      };
    } else {
      aggs[`${safeFieldName}_top`] = top;
    }
  });
  const searchBody = {
    query: {
      bool: {
        filter: filterCriteria
      }
    },
    aggs: (0, _query_utils.buildSamplerAggregation)(aggs, samplerShardSize),
    ...((0, _object_utils.isPopulatedObject)(runtimeMappings) ? {
      runtime_mappings: runtimeMappings
    } : {})
  };
  const {
    body
  } = await asCurrentUser.search({
    index,
    size,
    body: searchBody
  });
  const aggregations = body.aggregations;
  const aggsPath = (0, _query_utils.getSamplerAggregationsResponsePath)(samplerShardSize);
  const batchStats = [];
  fields.forEach((field, i) => {
    const safeFieldName = (0, _query_utils.getSafeAggregationName)(field.fieldName, i);
    const docCount = (0, _lodash.get)(aggregations, [...aggsPath, `${safeFieldName}_field_stats`, 'doc_count'], 0);
    const fieldStatsResp = (0, _lodash.get)(aggregations, [...aggsPath, `${safeFieldName}_field_stats`, 'actual_stats'], {});
    const topAggsPath = [...aggsPath, `${safeFieldName}_top`];
    if (samplerShardSize < 1 && field.cardinality >= _constants.SAMPLER_TOP_TERMS_THRESHOLD) {
      topAggsPath.push('top');
    }
    const topValues = (0, _lodash.get)(aggregations, [...topAggsPath, 'buckets'], []);
    const stats = {
      fieldName: field.fieldName,
      count: docCount,
      min: (0, _lodash.get)(fieldStatsResp, 'min', 0),
      max: (0, _lodash.get)(fieldStatsResp, 'max', 0),
      avg: (0, _lodash.get)(fieldStatsResp, 'avg', 0),
      isTopValuesSampled: field.cardinality >= _constants.SAMPLER_TOP_TERMS_THRESHOLD || samplerShardSize > 0,
      topValues,
      topValuesSampleSize: topValues.reduce((acc, curr) => acc + curr.doc_count, (0, _lodash.get)(aggregations, [...topAggsPath, 'sum_other_doc_count'], 0)),
      topValuesSamplerShardSize: field.cardinality >= _constants.SAMPLER_TOP_TERMS_THRESHOLD ? _constants.SAMPLER_TOP_TERMS_SHARD_SIZE : samplerShardSize
    };
    if (stats.count > 0) {
      const rawPercentiles = (0, _lodash.get)(aggregations, [...aggsPath, `${safeFieldName}_percentiles`, 'values'], []);
      const percentiles = rawPercentiles.filter(p => p.value != null);
      if (percentiles.length > 0) {
        const medianPercentile = (0, _lodash.find)(percentiles, {
          key: 50
        });
        stats.median = medianPercentile !== undefined ? medianPercentile.value : 0;
        stats.distribution = (0, _process_distribution_data.processDistributionData)(percentiles, PERCENTILE_SPACING, stats.min);
      } else {
        stats.median = 0;
      }
    }
    batchStats.push(stats);
  });
  return batchStats;
};
exports.getNumericFieldsStats = getNumericFieldsStats;
const getStringFieldsStats = async (client, indexPatternTitle, query, fields, samplerShardSize, timeFieldName, earliestMs, latestMs, runtimeMappings) => {
  const {
    asCurrentUser
  } = client;
  const index = indexPatternTitle;
  const size = 0;
  const filterCriteria = (0, _query_utils.buildBaseFilterCriteria)(timeFieldName, earliestMs, latestMs, query);
  const aggs = {};
  fields.forEach((field, i) => {
    const safeFieldName = (0, _query_utils.getSafeAggregationName)(field.fieldName, i);
    const top = {
      terms: {
        field: field.fieldName,
        size: 10,
        order: {
          _count: 'desc'
        }
      }
    };

    // If cardinality >= SAMPLE_TOP_TERMS_THRESHOLD, run the top terms aggregation
    // in a sampler aggregation, even if no sampling has been specified (samplerShardSize < 1).
    if (samplerShardSize < 1 && field.cardinality >= _constants.SAMPLER_TOP_TERMS_THRESHOLD) {
      aggs[`${safeFieldName}_top`] = {
        sampler: {
          shard_size: _constants.SAMPLER_TOP_TERMS_SHARD_SIZE
        },
        aggs: {
          top
        }
      };
    } else {
      aggs[`${safeFieldName}_top`] = top;
    }
  });
  const searchBody = {
    query: {
      bool: {
        filter: filterCriteria
      }
    },
    aggs: (0, _query_utils.buildSamplerAggregation)(aggs, samplerShardSize),
    ...((0, _object_utils.isPopulatedObject)(runtimeMappings) ? {
      runtime_mappings: runtimeMappings
    } : {})
  };
  const {
    body
  } = await asCurrentUser.search({
    index,
    size,
    body: searchBody
  });
  const aggregations = body.aggregations;
  const aggsPath = (0, _query_utils.getSamplerAggregationsResponsePath)(samplerShardSize);
  const batchStats = [];
  fields.forEach((field, i) => {
    const safeFieldName = (0, _query_utils.getSafeAggregationName)(field.fieldName, i);
    const topAggsPath = [...aggsPath, `${safeFieldName}_top`];
    if (samplerShardSize < 1 && field.cardinality >= _constants.SAMPLER_TOP_TERMS_THRESHOLD) {
      topAggsPath.push('top');
    }
    const topValues = (0, _lodash.get)(aggregations, [...topAggsPath, 'buckets'], []);
    const stats = {
      fieldName: field.fieldName,
      isTopValuesSampled: field.cardinality >= _constants.SAMPLER_TOP_TERMS_THRESHOLD || samplerShardSize > 0,
      topValues,
      topValuesSampleSize: topValues.reduce((acc, curr) => acc + curr.doc_count, (0, _lodash.get)(aggregations, [...topAggsPath, 'sum_other_doc_count'], 0)),
      topValuesSamplerShardSize: field.cardinality >= _constants.SAMPLER_TOP_TERMS_THRESHOLD ? _constants.SAMPLER_TOP_TERMS_SHARD_SIZE : samplerShardSize
    };
    batchStats.push(stats);
  });
  return batchStats;
};
exports.getStringFieldsStats = getStringFieldsStats;
const getDateFieldsStats = async (client, indexPatternTitle, query, fields, samplerShardSize, timeFieldName, earliestMs, latestMs, runtimeMappings) => {
  const {
    asCurrentUser
  } = client;
  const index = indexPatternTitle;
  const size = 0;
  const filterCriteria = (0, _query_utils.buildBaseFilterCriteria)(timeFieldName, earliestMs, latestMs, query);
  const aggs = {};
  fields.forEach((field, i) => {
    const safeFieldName = (0, _query_utils.getSafeAggregationName)(field.fieldName, i);
    aggs[`${safeFieldName}_field_stats`] = {
      filter: {
        exists: {
          field: field.fieldName
        }
      },
      aggs: {
        actual_stats: {
          stats: {
            field: field.fieldName
          }
        }
      }
    };
  });
  const searchBody = {
    query: {
      bool: {
        filter: filterCriteria
      }
    },
    aggs: (0, _query_utils.buildSamplerAggregation)(aggs, samplerShardSize),
    ...((0, _object_utils.isPopulatedObject)(runtimeMappings) ? {
      runtime_mappings: runtimeMappings
    } : {})
  };
  const {
    body
  } = await asCurrentUser.search({
    index,
    size,
    body: searchBody
  });
  const aggregations = body.aggregations;
  const aggsPath = (0, _query_utils.getSamplerAggregationsResponsePath)(samplerShardSize);
  const batchStats = [];
  fields.forEach((field, i) => {
    const safeFieldName = (0, _query_utils.getSafeAggregationName)(field.fieldName, i);
    const docCount = (0, _lodash.get)(aggregations, [...aggsPath, `${safeFieldName}_field_stats`, 'doc_count'], 0);
    const fieldStatsResp = (0, _lodash.get)(aggregations, [...aggsPath, `${safeFieldName}_field_stats`, 'actual_stats'], {});
    batchStats.push({
      fieldName: field.fieldName,
      count: docCount,
      earliest: (0, _lodash.get)(fieldStatsResp, 'min', 0),
      latest: (0, _lodash.get)(fieldStatsResp, 'max', 0)
    });
  });
  return batchStats;
};
exports.getDateFieldsStats = getDateFieldsStats;
const getBooleanFieldsStats = async (client, indexPatternTitle, query, fields, samplerShardSize, timeFieldName, earliestMs, latestMs, runtimeMappings) => {
  const {
    asCurrentUser
  } = client;
  const index = indexPatternTitle;
  const size = 0;
  const filterCriteria = (0, _query_utils.buildBaseFilterCriteria)(timeFieldName, earliestMs, latestMs, query);
  const aggs = {};
  fields.forEach((field, i) => {
    const safeFieldName = (0, _query_utils.getSafeAggregationName)(field.fieldName, i);
    aggs[`${safeFieldName}_value_count`] = {
      filter: {
        exists: {
          field: field.fieldName
        }
      }
    };
    aggs[`${safeFieldName}_values`] = {
      terms: {
        field: field.fieldName,
        size: 2
      }
    };
  });
  const searchBody = {
    query: {
      bool: {
        filter: filterCriteria
      }
    },
    aggs: (0, _query_utils.buildSamplerAggregation)(aggs, samplerShardSize),
    ...((0, _object_utils.isPopulatedObject)(runtimeMappings) ? {
      runtime_mappings: runtimeMappings
    } : {})
  };
  const {
    body
  } = await asCurrentUser.search({
    index,
    size,
    body: searchBody
  });
  const aggregations = body.aggregations;
  const aggsPath = (0, _query_utils.getSamplerAggregationsResponsePath)(samplerShardSize);
  const batchStats = [];
  fields.forEach((field, i) => {
    const safeFieldName = (0, _query_utils.getSafeAggregationName)(field.fieldName, i);
    const stats = {
      fieldName: field.fieldName,
      count: (0, _lodash.get)(aggregations, [...aggsPath, `${safeFieldName}_value_count`, 'doc_count'], 0),
      trueCount: 0,
      falseCount: 0
    };
    const valueBuckets = (0, _lodash.get)(aggregations, [...aggsPath, `${safeFieldName}_values`, 'buckets'], []);
    valueBuckets.forEach(bucket => {
      stats[`${bucket.key_as_string}Count`] = bucket.doc_count;
    });
    batchStats.push(stats);
  });
  return batchStats;
};
exports.getBooleanFieldsStats = getBooleanFieldsStats;