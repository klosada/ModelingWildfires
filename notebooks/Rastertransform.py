import rasterio
from rasterio.warp import calculate_default_transform, reproject, Resampling

src_path = ""
ref_path = " "
out_path = " "


def align_and_resample_raster(src_path, ref_path, out_path,
                              resampling_method=Resampling.nearest):
    with rasterio.open(ref_path) as ref:
        ref_crs = ref.crs
        ref_transform = ref.transform
        ref_width = ref.width
        ref_height = ref.height

        with rasterio.open(src_path) as src:
            dst_transform, dst_width, dst_height = calculate_default_transform(
                src.crs, ref_crs, src.width, src.height, *src.bounds, dst_width=ref_width, dst_height=ref_height)

            kwargs = src.meta.copy()
            kwargs.update({
                'crs': ref_crs,
                'transform': ref_transform,
                'width': ref_width,
                'height': ref_height
            })

            with rasterio.open(out_path, 'w', **kwargs) as dst:
                reproject(
                    source=rasterio.band(src, 1),
                    destination=rasterio.band(dst, 1),
                    src_transform=src.transform,
                    src_crs=src.crs,
                    dst_transform=ref_transform,
                    dst_crs=ref_crs,
                    resampling=resampling_method
                )
