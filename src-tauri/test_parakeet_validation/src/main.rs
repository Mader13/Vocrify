use std::path::Path;
use flate2::read::GzDecoder;
use tar::Archive;

fn main() {
    let archive_path = Path::new("e:/Dev/Transcribe-video/parakeet_test.tar.gz"); // The downloaded real tar
    let dest_dir = Path::new("e:/Dev/Transcribe-video/test_real_extract");
    
    // clean up if exists
    if dest_dir.exists() {
        std::fs::remove_dir_all(dest_dir).unwrap();
    }
    
    let file = std::fs::File::open(archive_path).unwrap();
    let decoder = GzDecoder::new(file);
    let mut tarball = Archive::new(decoder);
    
    match tarball.unpack(dest_dir) {
        Ok(_) => println!("Successfully unpacked!"),
        Err(e) => {
            println!("Error unpacking: {:?}", e);
            return;
        }
    }
    
    // let's see what we extracted
    for entry in walkdir::WalkDir::new(dest_dir) {
        let entry = entry.unwrap();
        println!("Extracted file: {:?}", entry.path());
    }
}
