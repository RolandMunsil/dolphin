#pragma once

#include "Actions.h"

struct AdvantageUpdatingState
{
  float expectedOptimalValue;
  ScoredActions advantages;
};

struct Chunk
{
  AdvantageUpdatingState going_right_way_state;
  AdvantageUpdatingState going_wrong_way_state;

  Chunk()
  {
    going_right_way_state = AdvantageUpdatingState();
    going_wrong_way_state = AdvantageUpdatingState();
  }
};

struct ChunkCoordinates
{
  s16 x, y, z;

  bool operator==(const ChunkCoordinates& other) const
  {
    return x == other.x && y == other.y && z == other.z;
  }
};

struct ChunkCoordinatesHasher
{
  std::size_t operator()(const ChunkCoordinates& key) const
  {
    size_t hash = (u32)key.x | ((u32)key.y << 16);
    hash ^= (u32)key.z << 8;
    return hash;
  }
};
